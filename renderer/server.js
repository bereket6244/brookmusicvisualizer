/**
 * Studio backend (dev-time only): a small Express server that gives the
 * browser studio access to things a browser can't do — running the Python
 * parser and launching render jobs. The Vite dev server proxies /api and
 * /samples here (see studio/vite.config.ts).
 *
 * Endpoints:
 *   GET  /api/samples          list sample timelines in samples/
 *   POST /api/parse?name=x.mid raw MIDI bytes -> parsed timeline
 *                              (saved under output/, so renders can use it)
 *   POST /api/render           spawn renderer/render.js as a child job
 *   GET  /api/jobs/:id         poll job status + log tail
 */

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import express from "express";

import { loadConfig, ROOT } from "./lib/config.js";
import { parseMidi } from "./lib/python.js";

const config = loadConfig();
const app = express();
app.use(express.json());

// Sample MIDIs/timelines are served as-is (the studio fetches these URLs).
app.use("/samples", express.static(path.join(ROOT, "samples")));
app.use("/output", express.static(path.join(ROOT, "output")));

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
      const rawName = String(req.query.name || "upload.mid");
      const safe = rawName.replace(/[^a-zA-Z0-9._-]/g, "_");
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

// ---------------------------------------------------------------------------
// Render jobs: each job is a renderer/render.js child process; the studio
// polls /api/jobs/:id for the log tail.
// ---------------------------------------------------------------------------

const jobs = new Map();

app.post("/api/render", (req, res) => {
  const { timeline, visualizer, params, fps, width, height, name } = req.body;
  if (!timeline || !visualizer) {
    return res.status(400).send("timeline and visualizer are required");
  }
  const jobId = crypto.randomBytes(6).toString("hex");
  const cliArgs = [
    path.join(ROOT, "renderer", "render.js"),
    "--timeline", timeline,
    "--visualizer", visualizer,
    "--fps", String(fps ?? 30),
    "--width", String(width ?? 1920),
    "--height", String(height ?? 1080),
    "--name", String(name ?? "render").replace(/[^a-zA-Z0-9._-]/g, "_"),
    "--params", JSON.stringify(params ?? {}),
  ];
  const child = spawn(process.execPath, cliArgs, { cwd: ROOT });
  const job = { status: "running", log: [], startedAt: Date.now() };
  jobs.set(jobId, job);

  const append = (chunk) => {
    for (const line of String(chunk).split(/\r?\n/)) {
      if (line.trim()) job.log.push(line.trim());
    }
    if (job.log.length > 500) job.log.splice(0, job.log.length - 500);
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  child.on("close", (code) => {
    job.status = code === 0 ? "done" : "failed";
  });

  res.json({ jobId });
});

app.get("/api/jobs/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).send("no such job");
  res.json(job);
});

// ---------------------------------------------------------------------------

const port = config.serverPort;
app.listen(port, "127.0.0.1", () => {
  console.log(`[server] studio backend on http://127.0.0.1:${port}`);
  console.log(`[server] project root: ${ROOT}`);
});
