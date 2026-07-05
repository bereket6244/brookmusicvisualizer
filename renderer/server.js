/**
 * Studio backend (dev-time only): a small Express server that gives the
 * browser studio access to things a browser can't do — running the Python
 * parser, storing presets/timelines on disk, and launching render jobs.
 * The Vite dev server proxies /api and /samples here (studio/vite.config.ts).
 *
 * Endpoints:
 *   GET    /api/samples              list sample timelines in samples/
 *   POST   /api/parse?name=x.mid     raw MIDI bytes -> parsed timeline
 *                                    (saved under output/uploads/)
 *   POST   /api/upload-timeline?name=x.json
 *                                    save a browser-loaded timeline JSON
 *                                    server-side so it can be rendered
 *   GET    /api/presets              list saved presets (presets/)
 *   GET    /api/presets/:file        one preset's JSON
 *   POST   /api/presets              save a preset
 *   DELETE /api/presets/:file        delete a preset
 *   POST   /api/upload-midi?name=x.mid
 *                                    save a MIDI WITHOUT parsing — used to
 *                                    attach a source MIDI to a timeline-only
 *                                    upload so audio rendering works
 *   GET    /api/audio-status         audio-render readiness (FluidSynth +
 *                                    SoundFont resolution chain; pass
 *                                    ?midi=path to also verify a source MIDI)
 *   POST   /api/render               spawn renderer/render.js as a child job
 *                                    (body may include audio:true + midi)
 *   GET    /api/jobs                 all jobs from this server session
 *   GET    /api/jobs/:id             poll one job's status + log tail
 *   GET    /api/renders              render history from render-info.json
 *                                    files under output/renders/
 */

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import express from "express";

import { audioStatus } from "./lib/audio.js";
import { loadConfig, ROOT } from "./lib/config.js";
import { parseMidi } from "./lib/python.js";

const config = loadConfig();
const app = express();
app.use(express.json({ limit: "100mb" }));

// Sample MIDIs/timelines are served as-is (the studio fetches these URLs).
app.use("/samples", express.static(path.join(ROOT, "samples")));
app.use("/output", express.static(path.join(ROOT, "output")));

const sanitizeName = (name) => String(name).replace(/[^a-zA-Z0-9._-]/g, "_");

// ---------------------------------------------------------------------------
// Timelines
// ---------------------------------------------------------------------------

app.get("/api/samples", (_req, res) => {
  const dir = path.join(ROOT, "samples");
  if (!fs.existsSync(dir)) return res.json([]);
  const samples = fs.readdirSync(dir)
    .filter((f) => f.endsWith(".timeline.json"))
    .map((f) => ({
      name: f.replace(".timeline.json", ""),
      timeline: `samples/${f}`,
      midi: fs.existsSync(path.join(dir, f.replace(".timeline.json", ".mid")))
        ? `samples/${f.replace(".timeline.json", ".mid")}`
        : null,
    }));
  res.json(samples);
});

// Uploaded MIDI arrives as the raw request body (no multipart parsing
// needed). Files are kept under output/ so a subsequent render job can
// reference the timeline by path — and so audio muxing can find the .mid.
app.post(
  "/api/parse",
  express.raw({ type: () => true, limit: "50mb" }),
  (req, res) => {
    try {
      const safe = sanitizeName(req.query.name || "upload.mid");
      const base = safe.replace(/\.(mid|midi)$/i, "");
      const uploadsDir = path.join(ROOT, "output", "uploads");
      fs.mkdirSync(uploadsDir, { recursive: true });
      const midiPath = path.join(uploadsDir, `${base}.mid`);
      fs.writeFileSync(midiPath, req.body);
      const timelinePath = path.join(uploadsDir, `${base}.timeline.json`);
      const timeline = parseMidi(midiPath, timelinePath);
      res.json({
        path: path.relative(ROOT, timelinePath).replaceAll("\\", "/"),
        midi: path.relative(ROOT, midiPath).replaceAll("\\", "/"),
        timeline,
      });
    } catch (err) {
      res.status(500).send(String(err.message ?? err));
    }
  },
);

// A timeline JSON loaded in the browser gets copied into the managed
// uploads folder so render jobs can reference it by server-side path.
// (First-pass limitation: local JSON could be previewed but not rendered.)
app.post("/api/upload-timeline", (req, res) => {
  try {
    const timeline = req.body;
    if (timeline?.format !== "midicore-timeline") {
      return res.status(400).send("not a midicore timeline JSON");
    }
    const safe = sanitizeName(req.query.name || "upload.timeline.json")
      .replace(/\.timeline\.json$|\.json$/i, "");
    const uploadsDir = path.join(ROOT, "output", "uploads");
    fs.mkdirSync(uploadsDir, { recursive: true });
    const timelinePath = path.join(uploadsDir, `${safe}.timeline.json`);
    fs.writeFileSync(timelinePath, JSON.stringify(timeline));
    res.json({
      path: path.relative(ROOT, timelinePath).replaceAll("\\", "/"),
    });
  } catch (err) {
    res.status(500).send(String(err.message ?? err));
  }
});

// Attach a source MIDI without re-parsing (for timeline-only uploads that
// want audio: the timeline drives the visuals, this MIDI drives the sound).
app.post(
  "/api/upload-midi",
  express.raw({ type: () => true, limit: "50mb" }),
  (req, res) => {
    try {
      const safe = sanitizeName(req.query.name || "attached.mid");
      const base = safe.replace(/\.(mid|midi)$/i, "");
      const uploadsDir = path.join(ROOT, "output", "uploads");
      fs.mkdirSync(uploadsDir, { recursive: true });
      const midiPath = path.join(uploadsDir, `${base}.mid`);
      fs.writeFileSync(midiPath, req.body);
      res.json({
        midi: path.relative(ROOT, midiPath).replaceAll("\\", "/"),
      });
    } catch (err) {
      res.status(500).send(String(err.message ?? err));
    }
  },
);

// Audio-render readiness for the studio's status indicator. The check is
// cheap (one `fluidsynth --version` + a couple of stat calls) but not
// free, so the studio calls it on load / timeline change, not per frame.
app.get("/api/audio-status", (req, res) => {
  const status = audioStatus();
  if (req.query.midi) {
    const midiPath = path.join(ROOT, String(req.query.midi));
    // Guard against path escape; the midi param is a project-relative path.
    status.midiOk = midiPath.startsWith(ROOT) && fs.existsSync(midiPath);
  }
  res.json(status);
});

// ---------------------------------------------------------------------------
// Presets — stored as pretty JSON files under presets/ (repo root) so they
// are easy to commit, diff, share, and feed to the CLI.
// ---------------------------------------------------------------------------

const PRESETS_DIR = path.join(ROOT, "presets");

app.get("/api/presets", (_req, res) => {
  if (!fs.existsSync(PRESETS_DIR)) return res.json([]);
  const out = [];
  for (const f of fs.readdirSync(PRESETS_DIR)) {
    if (!f.endsWith(".preset.json")) continue;
    try {
      const p = JSON.parse(fs.readFileSync(path.join(PRESETS_DIR, f), "utf-8"));
      out.push({ file: f, name: p.name ?? f, visualizer: p.visualizer ?? "?" });
    } catch { /* skip unreadable preset */ }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  res.json(out);
});

app.get("/api/presets/:file", (req, res) => {
  const file = sanitizeName(req.params.file);
  const full = path.join(PRESETS_DIR, file);
  if (!file.endsWith(".preset.json") || !fs.existsSync(full)) {
    return res.status(404).send("no such preset");
  }
  res.sendFile(full);
});

app.post("/api/presets", (req, res) => {
  const preset = req.body;
  if (preset?.format !== "music-visualizer-preset" || !preset.name) {
    return res.status(400).send("not a preset (format/name missing)");
  }
  fs.mkdirSync(PRESETS_DIR, { recursive: true });
  const file = `${sanitizeName(preset.name)}.preset.json`;
  fs.writeFileSync(
    path.join(PRESETS_DIR, file), JSON.stringify(preset, null, 2));
  res.json({ file });
});

app.delete("/api/presets/:file", (req, res) => {
  const file = sanitizeName(req.params.file);
  const full = path.join(PRESETS_DIR, file);
  if (!file.endsWith(".preset.json") || !fs.existsSync(full)) {
    return res.status(404).send("no such preset");
  }
  fs.unlinkSync(full);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Render jobs: each job is a renderer/render.js child process; the studio
// polls /api/jobs/:id for the log tail. render.js emits "[render-json] {…}"
// lines carrying structured metadata (output dir, capture stats) that we
// fold into the job record.
// ---------------------------------------------------------------------------

const jobs = new Map();

app.post("/api/render", (req, res) => {
  const { timeline, visualizer, params, fps, width, height, name, capture,
    audio, midi } = req.body;
  if (!timeline || !visualizer) {
    return res.status(400).send("timeline and visualizer are required");
  }
  if (audio && !midi) {
    // Fail fast with a clear message instead of a mid-render surprise: the
    // studio always knows the MIDI path when audio is enabled.
    return res.status(400).send(
      "audio:true requires a midi path (the timeline alone cannot be "
      + "synthesized — upload the source .mid or attach one)");
  }
  const jobId = crypto.randomBytes(6).toString("hex");
  const cliArgs = [
    path.join(ROOT, "renderer", "render.js"),
    "--timeline", timeline,
    "--visualizer", visualizer,
    "--fps", String(fps ?? 30),
    "--width", String(width ?? 1920),
    "--height", String(height ?? 1080),
    "--name", sanitizeName(name ?? "render"),
    "--capture", String(capture ?? "auto"),
    "--params", JSON.stringify(params ?? {}),
    ...(audio ? ["--audio", "--midi", String(midi)] : []),
  ];
  const child = spawn(process.execPath, cliArgs, { cwd: ROOT });
  const job = {
    status: "running",
    log: [],
    startedAt: Date.now(),
    visualizer,
    timeline,
    audioRequested: Boolean(audio),
    audio: null, // filled from the renderer's [render-json] audio event
    outDir: null,
    command: `node ${cliArgs.map((a) => (/[ "{]/.test(a) ? `'${a}'` : a)).join(" ")}`,
  };
  jobs.set(jobId, job);

  const append = (chunk) => {
    for (const line of String(chunk).split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith("[render-json] ")) {
        try {
          const info = JSON.parse(trimmed.slice("[render-json] ".length));
          if (info.jobDir) job.outDir = info.jobDir;
          if (info.captureMode) job.captureMode = info.captureMode;
          if (info.captureFps) job.captureFps = info.captureFps;
          if (info.event === "audio") {
            const { event, ...audioInfo } = info;
            job.audio = audioInfo; // { requested, ok, midi, soundfont?, output?, reason? }
          }
        } catch { /* malformed metadata line — ignore */ }
        continue; // metadata lines stay out of the human-readable log
      }
      job.log.push(trimmed);
    }
    if (job.log.length > 500) job.log.splice(0, job.log.length - 500);
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  child.on("close", (code) => {
    job.status = code === 0 ? "done" : "failed";
    job.finishedAt = Date.now();
  });

  res.json({ jobId });
});

app.get("/api/jobs", (_req, res) => {
  res.json([...jobs.entries()].map(([id, j]) => ({ id, ...j, log: undefined })));
});

app.get("/api/jobs/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).send("no such job");
  res.json(job);
});

// Render history survives server restarts: every finished render leaves a
// render-info.json in its output folder; failed in-session jobs are merged in.
app.get("/api/renders", (_req, res) => {
  const rendersDir = path.join(ROOT, config.render.outputDir);
  const entries = [];
  if (fs.existsSync(rendersDir)) {
    for (const dir of fs.readdirSync(rendersDir)) {
      const infoPath = path.join(rendersDir, dir, "render-info.json");
      if (!fs.existsSync(infoPath)) continue;
      try {
        const info = JSON.parse(fs.readFileSync(infoPath, "utf-8"));
        entries.push({
          dir: path.join(config.render.outputDir, dir).replaceAll("\\", "/"),
          name: info.name,
          visualizer: info.visualizer,
          fps: info.fps,
          width: info.width,
          height: info.height,
          totalFrames: info.totalFrames,
          captureMode: info.captureMode,
          captureFps: info.captureFps,
          command: info.command,
          audio: typeof info.audio === "object" ? info.audio : null,
          finishedAt: info.finishedAt,
          status: "done",
        });
      } catch { /* half-written info file — skip */ }
    }
  }
  // Failed jobs never write render-info.json; surface them from memory.
  for (const [id, j] of jobs) {
    if (j.status === "failed") {
      entries.push({
        dir: j.outDir ?? `(job ${id})`,
        name: sanitizeName(j.visualizer ?? "render"),
        visualizer: j.visualizer,
        command: j.command,
        status: "failed",
        finishedAt: j.finishedAt
          ? new Date(j.finishedAt).toISOString() : undefined,
      });
    }
  }
  entries.sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt)));
  res.json(entries.slice(0, 50));
});

// ---------------------------------------------------------------------------

const port = config.serverPort;
app.listen(port, "127.0.0.1", () => {
  console.log(`[server] studio backend on http://127.0.0.1:${port}`);
  console.log(`[server] project root: ${ROOT}`);
});
