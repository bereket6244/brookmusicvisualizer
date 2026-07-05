/**
 * Deterministic offline renderer.
 *
 *   node renderer/render.js --timeline samples/prelude_c.timeline.json
 *                           [--visualizer circular-accumulator]
 *                           [--fps 30] [--width 1920] [--height 1080]
 *                           [--name myrender] [--tail 1.5]
 *                           [--params '{"colorMode":"track"}']
 *                           [--capture auto|canvas|screenshot]
 *                           [--keep-frames] [--audio [--midi path.mid]]
 *
 * Pipeline:
 *   1. build studio/dist if missing (same visualizer code as the studio)
 *   2. serve dist on an ephemeral local port
 *   3. Playwright opens render.html at the exact output resolution
 *   4. for each frame: t = frame / fps -> draw + capture a PNG
 *      (NO real-time playback, NO screen recording). Two capture modes:
 *        canvas      page-side canvas.toDataURL -> base64 -> file. Fast
 *                    (no compositor wait, no CDP screenshot round-trip);
 *                    needs the visualizer to draw one full-size canvas
 *                    with preserveDrawingBuffer (all bundled ones do).
 *        screenshot  Playwright page.screenshot per frame. Slower but
 *                    works for ANY page content. The reliable fallback.
 *        auto        try canvas once; on any problem use screenshot.
 *   5. ffmpeg assembles frames -> H.264 MP4
 *   6. optional: fluidsynth renders the source MIDI to WAV, ffmpeg muxes
 *      it in; any audio failure is logged and the silent MP4 remains
 *   7. frames are deleted unless --keep-frames (18k PNGs for a 10-minute
 *      piece — don't hoard them by accident)
 *
 * Output lands in output/renders/<name>-<timestamp>/.
 * Lines prefixed "[render-json]" are machine-readable job metadata for
 * the studio backend (renderer/server.js) — keep them stable.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import express from "express";
import { chromium } from "playwright";

import { renderAudio } from "./lib/audio.js";
import { fromRoot, loadConfig, ROOT } from "./lib/config.js";
import { encodeFrames, muxAudio } from "./lib/ffmpeg.js";

// ---------------------------------------------------------------------------
// CLI args (tiny hand-rolled parser: --key value and boolean --flags)
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const flags = new Set(["keep-frames", "audio", "help"]);
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    if (!raw.startsWith("--")) continue;
    const key = raw.slice(2);
    if (flags.has(key)) args[key] = true;
    else args[key] = argv[++i];
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.timeline) {
  console.log(
    "usage: node renderer/render.js --timeline <timeline.json> "
    + "[--visualizer id] [--fps n] [--width n] [--height n] [--name s] "
    + "[--tail s] [--params json] [--out dir] [--capture auto|canvas|screenshot] "
    + "[--keep-frames] [--audio] [--midi file.mid]");
  process.exit(args.help ? 0 : 1);
}

const config = loadConfig();
const settings = {
  timeline: fromRoot(args.timeline),
  visualizer: args.visualizer ?? "circular-accumulator",
  fps: Number(args.fps ?? config.render.fps),
  width: Number(args.width ?? config.render.width),
  height: Number(args.height ?? config.render.height),
  tail: Number(args.tail ?? config.render.tailSeconds),
  name: args.name ?? "render",
  outDir: fromRoot(args.out ?? config.render.outputDir),
  params: args.params ? JSON.parse(args.params) : {},
  capture: args.capture ?? config.render.capture ?? "auto",
  keepFrames: Boolean(args["keep-frames"] ?? config.render.keepFrames),
  audio: Boolean(args.audio),
  midi: args.midi ? fromRoot(args.midi) : null,
};
if (!["auto", "canvas", "screenshot"].includes(settings.capture)) {
  console.error(`invalid --capture "${settings.capture}" (auto|canvas|screenshot)`);
  process.exit(1);
}

// ---------------------------------------------------------------------------

function log(msg) {
  console.log(`[render] ${msg}`);
}

/** Machine-readable status line the studio backend parses (job history). */
function logJson(obj) {
  console.log(`[render-json] ${JSON.stringify(obj)}`);
}

function ensureStudioBuilt() {
  const dist = path.join(ROOT, "studio", "dist", "render.html");
  if (fs.existsSync(dist)) return;
  log("studio/dist missing — running `vite build studio` once…");
  const result = spawnSync("npx", ["vite", "build", "studio"], {
    cwd: ROOT,
    shell: true, // npx is a .cmd on Windows
    stdio: "inherit",
  });
  if (result.status !== 0 || !fs.existsSync(dist)) {
    throw new Error("vite build failed — run `npm run build` manually");
  }
}

function serveDist() {
  return new Promise((resolve) => {
    const app = express();
    app.use(express.static(path.join(ROOT, "studio", "dist")));
    const server = app.listen(0, "127.0.0.1", () => {
      resolve({ server, port: server.address().port });
    });
  });
}

/** Load an optional *.annotations.json sitting next to the timeline, so a
 * render sees exactly what the studio preview saw. */
function loadAnnotationsSidecar(timelinePath) {
  const sidecar = timelinePath.replace(/\.timeline\.json$/, ".annotations.json");
  if (sidecar === timelinePath || !fs.existsSync(sidecar)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(sidecar, "utf-8"));
    if (parsed?.format === "music-visualizer-annotations") {
      log(`annotations: ${path.relative(ROOT, sidecar)} (${parsed.labels?.length ?? 0} labels)`);
      return parsed;
    }
  } catch (err) {
    log(`annotations sidecar ignored (parse error: ${err.message})`);
  }
  return null;
}

async function main() {
  const timeline = JSON.parse(fs.readFileSync(settings.timeline, "utf-8"));
  const duration = timeline.meta.duration_seconds;
  // THE frame contract: totalFrames spanning duration + tail, t = f / fps.
  const totalFrames = Math.ceil((duration + settings.tail) * settings.fps);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const jobDir = path.join(settings.outDir, `${settings.name}-${stamp}`);
  const framesDir = path.join(jobDir, "frames");
  fs.mkdirSync(framesDir, { recursive: true });

  log(`timeline:   ${path.relative(ROOT, settings.timeline)}`);
  log(`visualizer: ${settings.visualizer}`);
  log(`resolution: ${settings.width}x${settings.height} @ ${settings.fps} fps`);
  log(`capture:    ${settings.capture}`);
  log(`duration:   ${duration.toFixed(2)}s + ${settings.tail}s tail `
    + `= ${totalFrames} frames`);
  log(`output:     ${path.relative(ROOT, jobDir)}`);
  logJson({ event: "start", jobDir: path.relative(ROOT, jobDir), totalFrames });

  ensureStudioBuilt();
  const { server, port } = await serveDist();

  const browser = await chromium.launch({
    args: [
      // Determinism/quality flags: fixed scale factor, consistent color.
      "--force-device-scale-factor=1",
      "--force-color-profile=srgb",
      "--disable-lcd-text",
    ],
  });
  let captureMode = settings.capture;
  let captureFps = 0;
  try {
    const page = await browser.newPage({
      viewport: { width: settings.width, height: settings.height },
    });
    page.on("pageerror", (err) => log(`page error: ${err.message}`));
    await page.goto(`http://127.0.0.1:${port}/render.html`);
    await page.waitForFunction(() => window.__viz?.ready, { timeout: 30000 });

    await page.evaluate(
      (payload) => window.__viz.load(payload),
      {
        timeline,
        visualizerId: settings.visualizer,
        params: settings.params,
        width: settings.width,
        height: settings.height,
        annotations: loadAnnotationsSidecar(settings.timeline),
      },
    );

    // -- resolve capture mode -------------------------------------------------
    // "auto" probes the fast canvas path once (frame 0, thrown away) and
    // falls back to screenshots on any error or wrong-size canvas.
    if (captureMode !== "screenshot") {
      try {
        const probe = await page.evaluate(() => {
          const url = window.__viz.captureFrame(0);
          const c = document.querySelector("#stage canvas");
          return { ok: url.startsWith("data:image/png"), w: c?.width, h: c?.height };
        });
        if (!probe.ok || probe.w !== settings.width || probe.h !== settings.height) {
          throw new Error(
            `canvas is ${probe.w}x${probe.h}, expected ${settings.width}x${settings.height}`);
        }
        captureMode = "canvas";
      } catch (err) {
        if (settings.capture === "canvas") {
          throw new Error(`canvas capture unavailable: ${err.message} `
            + "(use --capture screenshot)");
        }
        log(`canvas capture unavailable (${err.message}) — using screenshots`);
        captureMode = "screenshot";
      }
    }
    log(`capture mode resolved: ${captureMode}`);

    // -- frame loop -------------------------------------------------------------
    const startedAt = Date.now();
    for (let frame = 0; frame < totalFrames; frame++) {
      const t = frame / settings.fps;
      const framePath = path.join(
        framesDir, `frame_${String(frame).padStart(6, "0")}.png`);
      if (captureMode === "canvas") {
        // One evaluate round-trip returns the PNG as base64; decoding and
        // writing on the Node side keeps the page loop tight.
        const dataUrl = await page.evaluate(
          (tt) => window.__viz.captureFrame(tt), t);
        fs.writeFileSync(
          framePath,
          Buffer.from(dataUrl.slice("data:image/png;base64,".length), "base64"));
      } else {
        await page.evaluate((tt) => window.__viz.renderFrame(tt), t);
        await page.screenshot({
          path: framePath,
          clip: { x: 0, y: 0, width: settings.width, height: settings.height },
        });
      }
      if (frame % (settings.fps * 5) === 0 && frame > 0) {
        const rate = frame / ((Date.now() - startedAt) / 1000);
        const eta = Math.round((totalFrames - frame) / rate);
        log(`frame ${frame}/${totalFrames} (${rate.toFixed(1)} fps, `
          + `~${eta}s left)`);
      }
    }
    const captureSeconds = (Date.now() - startedAt) / 1000;
    captureFps = totalFrames / captureSeconds;
    log(`captured ${totalFrames} frames in ${captureSeconds.toFixed(1)}s `
      + `(${captureFps.toFixed(1)} frames/sec, mode: ${captureMode})`);
  } finally {
    await browser.close();
    server.close();
  }

  // -- assemble video ---------------------------------------------------------
  const silentPath = path.join(jobDir, `${settings.name}.mp4`);
  log("encoding MP4 with ffmpeg…");
  encodeFrames(
    path.join(framesDir, "frame_%06d.png"), settings.fps, silentPath);
  log(`wrote ${path.relative(ROOT, silentPath)}`);

  // -- optional audio ---------------------------------------------------------
  // Everything about the attempt is recorded (render-info.json + a
  // [render-json] line the studio backend folds into the job) so the UI
  // can say exactly what happened instead of hiding a silent fallback.
  const audioInfo = { requested: settings.audio, ok: false };
  if (settings.audio) {
    const midiPath = settings.midi
      // Convention: samples/foo.timeline.json sits next to samples/foo.mid
      ?? settings.timeline.replace(/\.timeline\.json$/, ".mid");
    audioInfo.midi = path.relative(ROOT, midiPath).replaceAll("\\", "/");
    if (!fs.existsSync(midiPath)) {
      audioInfo.reason = `source MIDI not found: ${audioInfo.midi} (pass --midi)`;
    } else {
      const wavPath = path.join(jobDir, `${settings.name}.wav`);
      log("rendering audio with fluidsynth…");
      const result = renderAudio(midiPath, wavPath);
      if (result.ok) {
        audioInfo.soundfont = path.relative(ROOT, result.soundfont).replaceAll("\\", "/");
        audioInfo.fluidsynth = result.fluidsynth;
        const withAudio = path.join(jobDir, `${settings.name}_audio.mp4`);
        muxAudio(silentPath, wavPath, withAudio);
        audioInfo.ok = true;
        audioInfo.output = path.basename(withAudio);
        log(`wrote ${path.relative(ROOT, withAudio)} (MP4 WITH AUDIO)`);
      } else {
        audioInfo.reason = result.reason;
      }
    }
    if (!audioInfo.ok) {
      log(`AUDIO SKIPPED: ${audioInfo.reason}`);
      log("the silent MP4 above is still valid output");
    }
    logJson({ event: "audio", ...audioInfo });
  }

  // -- provenance + cleanup ---------------------------------------------------
  // The reproduction command mirrors the studio's "Copy cmd" output.
  const command = [
    "node renderer/render.js",
    `--timeline "${path.relative(ROOT, settings.timeline).replaceAll("\\", "/")}"`,
    `--visualizer ${settings.visualizer}`,
    `--fps ${settings.fps}`,
    `--width ${settings.width}`,
    `--height ${settings.height}`,
    `--name ${settings.name}`,
    settings.capture !== "auto" ? `--capture ${settings.capture}` : "",
    Object.keys(settings.params).length
      ? `--params '${JSON.stringify(settings.params)}'` : "",
    settings.audio ? "--audio" : "",
    settings.audio && settings.midi
      ? `--midi "${path.relative(ROOT, settings.midi).replaceAll("\\", "/")}"` : "",
  ].filter(Boolean).join(" ");

  fs.writeFileSync(
    path.join(jobDir, "render-info.json"),
    JSON.stringify(
      {
        ...settings,
        timeline: path.relative(ROOT, settings.timeline),
        outDir: path.relative(ROOT, settings.outDir),
        midi: settings.midi ? path.relative(ROOT, settings.midi) : null,
        totalFrames,
        durationSeconds: duration,
        captureMode,
        captureFps: Number(captureFps.toFixed(2)),
        command,
        // Full audio provenance: requested?, succeeded?, which MIDI +
        // SoundFont were used, and which output file carries sound.
        audio: audioInfo,
        finishedAt: new Date().toISOString(),
      },
      null, 2,
    ),
  );
  if (!settings.keepFrames) {
    fs.rmSync(framesDir, { recursive: true, force: true });
    log("frames deleted (use --keep-frames to keep the PNGs)");
  }
  logJson({
    event: "done",
    jobDir: path.relative(ROOT, jobDir),
    captureMode,
    captureFps: Number(captureFps.toFixed(2)),
  });
  log(`DONE -> ${silentPath}`);
}

main().catch((err) => {
  console.error(`[render] FAILED: ${err.message}`);
  process.exit(1);
});
