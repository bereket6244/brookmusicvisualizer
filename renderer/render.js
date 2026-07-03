/**
 * Deterministic offline renderer.
 *
 *   node renderer/render.js --timeline samples/prelude_c.timeline.json
 *                           [--visualizer circular-accumulator]
 *                           [--fps 30] [--width 1920] [--height 1080]
 *                           [--name myrender] [--tail 1.5]
 *                           [--params '{"colorMode":"track"}']
 *                           [--keep-frames] [--audio [--midi path.mid]]
 *
 * Pipeline:
 *   1. build studio/dist if missing (same visualizer code as the studio)
 *   2. serve dist on an ephemeral local port
 *   3. Playwright opens render.html at the exact output resolution
 *   4. for each frame: t = frame / fps -> window.__viz.renderFrame(t)
 *      -> PNG screenshot (NO real-time playback, NO screen recording)
 *   5. ffmpeg assembles frames -> H.264 MP4
 *   6. optional: fluidsynth renders the source MIDI to WAV, ffmpeg muxes
 *      it in; any audio failure is logged and the silent MP4 remains
 *   7. frames are deleted unless --keep-frames (18k PNGs for a 10-minute
 *      piece — don't hoard them by accident)
 *
 * Output lands in output/renders/<name>-<timestamp>/.
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
    + "[--tail s] [--params json] [--out dir] [--keep-frames] "
    + "[--audio] [--midi file.mid]");
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
  keepFrames: Boolean(args["keep-frames"] ?? config.render.keepFrames),
  audio: Boolean(args.audio),
  midi: args.midi ? fromRoot(args.midi) : null,
};

// ---------------------------------------------------------------------------

function log(msg) {
  console.log(`[render] ${msg}`);
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
  log(`duration:   ${duration.toFixed(2)}s + ${settings.tail}s tail `
    + `= ${totalFrames} frames`);
  log(`output:     ${path.relative(ROOT, jobDir)}`);

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
      },
    );

    const startedAt = Date.now();
    for (let frame = 0; frame < totalFrames; frame++) {
      const t = frame / settings.fps;
      await page.evaluate((tt) => window.__viz.renderFrame(tt), t);
      await page.screenshot({
        path: path.join(framesDir,
          `frame_${String(frame).padStart(6, "0")}.png`),
        clip: { x: 0, y: 0, width: settings.width, height: settings.height },
      });
      if (frame % (settings.fps * 5) === 0 && frame > 0) {
        const rate = frame / ((Date.now() - startedAt) / 1000);
        const eta = Math.round((totalFrames - frame) / rate);
        log(`frame ${frame}/${totalFrames} (${rate.toFixed(1)} fps, `
          + `~${eta}s left)`);
      }
    }
    log(`captured ${totalFrames} frames in `
      + `${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
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
  let audioResult = null;
  if (settings.audio) {
    const midiPath = settings.midi
      // Convention: samples/foo.timeline.json sits next to samples/foo.mid
      ?? settings.timeline.replace(/\.timeline\.json$/, ".mid");
    if (!fs.existsSync(midiPath)) {
      audioResult = { ok: false, reason: `MIDI file not found: ${midiPath} (pass --midi)` };
    } else {
      const wavPath = path.join(jobDir, `${settings.name}.wav`);
      log("rendering audio with fluidsynth…");
      audioResult = renderAudio(midiPath, wavPath);
      if (audioResult.ok) {
        const withAudio = path.join(jobDir, `${settings.name}_audio.mp4`);
        muxAudio(silentPath, wavPath, withAudio);
        log(`wrote ${path.relative(ROOT, withAudio)}`);
      }
    }
    if (audioResult && !audioResult.ok) {
      log(`AUDIO SKIPPED: ${audioResult.reason}`);
      log("the silent MP4 above is still valid output");
    }
  }

  // -- provenance + cleanup ---------------------------------------------------
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
        audio: audioResult ?? "not requested",
        finishedAt: new Date().toISOString(),
      },
      null, 2,
    ),
  );
  if (!settings.keepFrames) {
    fs.rmSync(framesDir, { recursive: true, force: true });
    log("frames deleted (use --keep-frames to keep the PNGs)");
  }
  log(`DONE -> ${silentPath}`);
}

main().catch((err) => {
  console.error(`[render] FAILED: ${err.message}`);
  process.exit(1);
});
