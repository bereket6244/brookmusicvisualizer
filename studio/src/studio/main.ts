/**
 * MIDI Visualizer Studio — single-page dev/preview UI.
 *
 * Load a timeline (sample list, .mid upload via the backend parser, or a
 * .timeline.json directly), pick a visualizer from the registry, preview
 * with play/pause/seek (+ optional Web Audio preview), and launch offline
 * renders through the backend. The preview uses the exact same
 * TimingEngine + visualizer code as the offline render — only the clock
 * source differs (wall clock here, frame/fps there).
 */

import "./style.css";

import { frameCount } from "../core/frame-math";
import type { Timeline } from "../core/timeline-types";
import { TimingEngine } from "../core/timing-engine";
import { getVisualizer, listVisualizers } from "../visualizers/registry";
import type {
  ParamValues,
  VisualizerDefinition,
  VisualizerInstance,
} from "../visualizers/types";
import { defaultParams } from "../visualizers/types";
import { AudioPreview } from "./audio-preview";

const PREVIEW_W = 1280;
const PREVIEW_H = 720;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface State {
  timeline: Timeline | null;
  /** Server-side path of the timeline (needed to launch renders). */
  timelinePath: string | null;
  engine: TimingEngine | null;
  vizDef: VisualizerDefinition | null;
  viz: VisualizerInstance | null;
  params: ParamValues;
  playing: boolean;
  t: number;
  /** performance.now() ms at the moment play started. */
  playWallStart: number;
  playTStart: number;
}

const state: State = {
  timeline: null, timelinePath: null, engine: null,
  vizDef: null, viz: null, params: {},
  playing: false, t: 0, playWallStart: 0, playTStart: 0,
};

const audio = new AudioPreview();

// ---------------------------------------------------------------------------
// DOM scaffold
// ---------------------------------------------------------------------------

const app = document.getElementById("app")!;
app.innerHTML = `
  <div class="sidebar">
    <h1>MIDI Visualizer Studio</h1>
    <div class="subtitle">timeline-driven, deterministic by construction</div>

    <div class="section">
      <h2>Timeline</h2>
      <label>Sample piece</label>
      <select id="sample-select"><option value="">— choose a sample —</option></select>
      <label>Upload MIDI (parsed by the backend)</label>
      <input type="file" id="midi-file" accept=".mid,.midi" />
      <label>Or load a timeline JSON directly</label>
      <input type="file" id="json-file" accept=".json" />
      <div class="status" id="timeline-status">no timeline loaded</div>
      <table class="meta-table" id="meta-table"></table>
    </div>

    <div class="section">
      <h2>Visualizer</h2>
      <select id="viz-select"></select>
      <div class="status" id="viz-desc"></div>
      <div id="param-form"></div>
      <div class="row"><button class="secondary" id="reset-params">Reset parameters</button></div>
    </div>

    <div class="section">
      <h2>Render</h2>
      <div class="row">
        <div><label>FPS</label><input type="number" id="r-fps" value="30" min="1" max="120"/></div>
        <div><label>Width</label><input type="number" id="r-w" value="1920" step="2"/></div>
        <div><label>Height</label><input type="number" id="r-h" value="1080" step="2"/></div>
      </div>
      <label>Output name</label>
      <input type="text" id="r-name" value="render" />
      <div class="row">
        <button id="render-btn">Render video</button>
      </div>
      <div class="status" id="render-status"></div>
    </div>
  </div>

  <div class="main">
    <div class="viewport" id="viewport">
      <div class="placeholder">load a timeline to begin</div>
    </div>
    <div class="transport">
      <button id="play-btn" disabled>Play</button>
      <input type="range" id="seek" min="0" max="1000" value="0" step="1" />
      <div class="audio-toggle">
        <input type="checkbox" id="audio-toggle" />
        <label for="audio-toggle" style="margin:0">audio (synth preview)</label>
      </div>
      <div class="time" id="time-label">0.00 / 0.00s</div>
    </div>
  </div>
`;

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;

const viewport = $("viewport");
const playBtn = $<HTMLButtonElement>("play-btn");
const seek = $<HTMLInputElement>("seek");
const timeLabel = $("time-label");

// ---------------------------------------------------------------------------
// Timeline loading
// ---------------------------------------------------------------------------

function setStatus(id: string, msg: string, cls: "" | "error" | "ok" = "") {
  const el = $(id);
  el.textContent = msg;
  el.className = `status ${cls}`;
}

function loadTimeline(timeline: Timeline, path: string | null, label: string) {
  state.timeline = timeline;
  state.timelinePath = path;
  state.engine = new TimingEngine(timeline);
  state.t = 0;
  stopPlayback();
  audio.setEngine(state.engine);
  playBtn.disabled = false;
  setStatus("timeline-status", `loaded: ${label}`, "ok");
  renderMetaTable(timeline);
  rebuildVisualizer();
  if (!path) {
    setStatus("render-status",
      "note: locally loaded JSON can be previewed but not rendered — the "
      + "backend needs a file path. Put it in samples/ or upload the .mid.");
  } else {
    setStatus("render-status", "");
  }
}

function renderMetaTable(tl: Timeline) {
  const m = tl.meta;
  const sig = tl.time_signature_map[0];
  const rows: [string, string][] = [
    ["file", m.source_file],
    ["duration", `${m.duration_seconds.toFixed(2)} s`],
    ["notes", String(m.note_count)],
    ["tracks", String(m.track_count)],
    ["PPQ", String(m.ticks_per_beat)],
    ["tempo", `${tl.tempo_map[0].bpm.toFixed(1)} BPM${tl.tempo_map.length > 1 ? " (changes)" : ""}`],
    ["time sig", sig ? `${sig.numerator}/${sig.denominator}` : "?"],
    ["sustain pedal", m.has_sustain_data ? "yes (CC64)" : "none"],
  ];
  $("meta-table").innerHTML = rows
    .map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`)
    .join("");
}

async function fetchSamples() {
  try {
    const res = await fetch("/api/samples");
    if (!res.ok) throw new Error(String(res.status));
    const samples: { name: string; timeline: string }[] = await res.json();
    const select = $<HTMLSelectElement>("sample-select");
    for (const s of samples) {
      const opt = document.createElement("option");
      opt.value = s.timeline;
      opt.textContent = s.name;
      select.appendChild(opt);
    }
  } catch {
    setStatus("timeline-status",
      "backend not reachable — start it with `npm run dev` (samples/upload/"
      + "render need it). Local timeline JSON loading still works.", "error");
  }
}

$<HTMLSelectElement>("sample-select").addEventListener("change", async (e) => {
  const path = (e.target as HTMLSelectElement).value;
  if (!path) return;
  const res = await fetch(`/${path}`);
  const timeline: Timeline = await res.json();
  loadTimeline(timeline, path, path.split("/").pop()!);
});

$<HTMLInputElement>("midi-file").addEventListener("change", async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  setStatus("timeline-status", "parsing…");
  try {
    const res = await fetch(`/api/parse?name=${encodeURIComponent(file.name)}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: await file.arrayBuffer(),
    });
    if (!res.ok) throw new Error(await res.text());
    const { path, timeline } = await res.json();
    loadTimeline(timeline, path, file.name);
  } catch (err) {
    setStatus("timeline-status", `parse failed: ${err}`, "error");
  }
});

$<HTMLInputElement>("json-file").addEventListener("change", async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    const timeline = JSON.parse(await file.text()) as Timeline;
    if (timeline.format !== "midicore-timeline") {
      throw new Error("not a midicore timeline JSON");
    }
    loadTimeline(timeline, null, file.name);
  } catch (err) {
    setStatus("timeline-status", `load failed: ${err}`, "error");
  }
});

// ---------------------------------------------------------------------------
// Visualizer selection & params
// ---------------------------------------------------------------------------

function populateVizSelect() {
  const select = $<HTMLSelectElement>("viz-select");
  for (const def of listVisualizers()) {
    const opt = document.createElement("option");
    opt.value = def.id;
    opt.textContent = `${def.name} ${def.status === "dev" ? "[dev]" : ""}`;
    select.appendChild(opt);
  }
  select.addEventListener("change", () => selectVisualizer(select.value));
  selectVisualizer(select.value);
}

function selectVisualizer(id: string) {
  const def = getVisualizer(id);
  if (!def) return;
  state.vizDef = def;
  state.params = defaultParams(def);
  $("viz-desc").innerHTML =
    `${def.description} <span class="badge ${def.status}">${def.status}</span>`;
  buildParamForm(def);
  rebuildVisualizer();
}

function buildParamForm(def: VisualizerDefinition) {
  const form = $("param-form");
  form.innerHTML = "";
  for (const spec of def.params) {
    const label = document.createElement("label");
    label.textContent = spec.label;
    form.appendChild(label);
    let input: HTMLElement;
    if (spec.type === "select") {
      const sel = document.createElement("select");
      for (const o of spec.options ?? []) {
        const opt = document.createElement("option");
        opt.value = o;
        opt.textContent = o;
        sel.appendChild(opt);
      }
      sel.value = String(state.params[spec.key]);
      sel.addEventListener("change", () => updateParam(spec.key, sel.value));
      input = sel;
    } else if (spec.type === "boolean") {
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = Boolean(state.params[spec.key]);
      cb.addEventListener("change", () => updateParam(spec.key, cb.checked));
      input = cb;
    } else if (spec.type === "color") {
      const c = document.createElement("input");
      c.type = "color";
      c.value = String(state.params[spec.key]);
      c.addEventListener("input", () => updateParam(spec.key, c.value));
      input = c;
    } else {
      const num = document.createElement("input");
      num.type = "number";
      if (spec.min !== undefined) num.min = String(spec.min);
      if (spec.max !== undefined) num.max = String(spec.max);
      if (spec.step !== undefined) num.step = String(spec.step);
      num.value = String(state.params[spec.key]);
      num.addEventListener("change", () =>
        updateParam(spec.key, Number(num.value)));
      input = num;
    }
    form.appendChild(input);
  }
}

function updateParam(key: string, value: number | string | boolean) {
  state.params[key] = value;
  // Rebuild instead of patching: cheap at these scene sizes and guarantees
  // preview == render for any parameter.
  rebuildVisualizer();
}

$("reset-params").addEventListener("click", () => {
  if (!state.vizDef) return;
  state.params = defaultParams(state.vizDef);
  buildParamForm(state.vizDef);
  rebuildVisualizer();
});

function rebuildVisualizer() {
  state.viz?.dispose();
  state.viz = null;
  if (!state.engine || !state.vizDef) return;
  viewport.innerHTML = "";
  state.viz = state.vizDef.create({
    container: viewport,
    width: PREVIEW_W,
    height: PREVIEW_H,
    engine: state.engine,
    params: { ...state.params },
  });
  state.viz.renderAtTime(state.t);
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

function startPlayback() {
  if (!state.engine) return;
  if (state.t >= state.engine.durationSeconds) state.t = 0; // replay from start
  state.playing = true;
  state.playWallStart = performance.now();
  state.playTStart = state.t;
  playBtn.textContent = "Pause";
  audio.start(state.t);
}

function stopPlayback() {
  state.playing = false;
  playBtn.textContent = "Play";
  audio.stop();
}

playBtn.addEventListener("click", () => {
  state.playing ? stopPlayback() : startPlayback();
});

seek.addEventListener("input", () => {
  if (!state.engine) return;
  const wasPlaying = state.playing;
  stopPlayback();
  state.t = (Number(seek.value) / 1000) * state.engine.durationSeconds;
  if (wasPlaying) startPlayback();
});

$<HTMLInputElement>("audio-toggle").addEventListener("change", (e) => {
  audio.enabled = (e.target as HTMLInputElement).checked;
  if (state.playing) {
    // Restart scheduling from the current position with the new setting.
    audio.stop();
    audio.start(state.t);
  }
});

function tick() {
  requestAnimationFrame(tick);
  if (!state.engine || !state.viz) return;
  if (state.playing) {
    state.t = state.playTStart + (performance.now() - state.playWallStart) / 1000;
    if (state.t >= state.engine.durationSeconds) {
      state.t = state.engine.durationSeconds;
      stopPlayback();
    }
    seek.value = String(
      Math.round((state.t / state.engine.durationSeconds) * 1000));
  }
  state.viz.renderAtTime(state.t);
  const { bar, beat } = state.engine.barBeatAt(
    Math.min(state.t, state.engine.durationSeconds - 1e-6));
  timeLabel.textContent =
    `${state.t.toFixed(2)} / ${state.engine.durationSeconds.toFixed(2)}s`
    + `  ·  bar ${bar} beat ${beat.toFixed(1)}`;
}

// ---------------------------------------------------------------------------
// Render job launch + polling
// ---------------------------------------------------------------------------

$("render-btn").addEventListener("click", async () => {
  if (!state.timelinePath || !state.vizDef || !state.engine) {
    setStatus("render-status", "load a server-side timeline first", "error");
    return;
  }
  const fps = Number($<HTMLInputElement>("r-fps").value) || 30;
  const frames = frameCount(state.engine.durationSeconds, fps, 1.5);
  const body = {
    timeline: state.timelinePath,
    visualizer: state.vizDef.id,
    params: state.params,
    fps,
    width: Number($<HTMLInputElement>("r-w").value) || 1920,
    height: Number($<HTMLInputElement>("r-h").value) || 1080,
    name: $<HTMLInputElement>("r-name").value || "render",
  };
  setStatus("render-status", `starting render (~${frames} frames)…`);
  try {
    const res = await fetch("/api/render", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await res.text());
    const { jobId } = await res.json();
    pollJob(jobId);
  } catch (err) {
    setStatus("render-status", `render failed to start: ${err}`, "error");
  }
});

async function pollJob(jobId: string) {
  const timer = setInterval(async () => {
    try {
      const res = await fetch(`/api/jobs/${jobId}`);
      const job = await res.json();
      const tail = job.log.slice(-3).join("\n");
      if (job.status === "done") {
        clearInterval(timer);
        setStatus("render-status", `done!\n${tail}`, "ok");
      } else if (job.status === "failed") {
        clearInterval(timer);
        setStatus("render-status", `render failed:\n${tail}`, "error");
      } else {
        setStatus("render-status", tail);
      }
    } catch {
      clearInterval(timer);
      setStatus("render-status", "lost contact with backend", "error");
    }
  }, 1500);
}

// ---------------------------------------------------------------------------

populateVizSelect();
void fetchSamples();
requestAnimationFrame(tick);
