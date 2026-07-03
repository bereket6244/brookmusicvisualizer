/**
 * MIDI Visualizer Studio — the adaptive creative-control workspace.
 *
 * Load a timeline (sample list, .mid upload, or .timeline.json upload —
 * both go through the backend so they can be rendered), pick a visualizer,
 * and explore: every control in the parameter panel is generated from the
 * visualizer's own ParamSpec schema (see param-panel.ts), so new
 * visualizers get a full UI for free. Presets, seeded randomize/mutate,
 * still capture, a timeline inspector, and render history round out the
 * workflow. The preview uses the exact same TimingEngine + visualizer code
 * as the offline render — only the clock source differs (wall clock here,
 * frame/fps there).
 */

import "./style.css";

import type { AnnotationSet } from "../core/annotations";
import { parseAnnotations } from "../core/annotations";
import { frameCount } from "../core/frame-math";
import type { Timeline } from "../core/timeline-types";
import { TimingEngine } from "../core/timing-engine";
import { mutateParams, randomizeParams, sanitizeParams } from "../visualizers/params";
import { getVisualizer, listVisualizers } from "../visualizers/registry";
import type {
  ParamValues,
  VisualizerDefinition,
  VisualizerInstance,
} from "../visualizers/types";
import { defaultParams } from "../visualizers/types";
import { AudioPreview } from "./audio-preview";
import { ParamPanel } from "./param-panel";
import type { Preset, RenderSettings } from "./presets";
import { buildRenderCommand, makePreset, parsePreset } from "./presets";

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
  annotations: AnnotationSet | null;
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
  timeline: null, timelinePath: null, engine: null, annotations: null,
  vizDef: null, viz: null, params: {},
  playing: false, t: 0, playWallStart: 0, playTStart: 0,
};

const audio = new AudioPreview();
let paramPanel: ParamPanel | null = null;

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
      <label>Or upload a timeline JSON</label>
      <input type="file" id="json-file" accept=".json" />
      <label>Annotations (optional sidecar JSON)</label>
      <input type="file" id="annotations-file" accept=".json" />
      <div class="status" id="timeline-status">no timeline loaded</div>
      <table class="meta-table" id="meta-table"></table>
    </div>

    <div class="section">
      <h2>Visualizer</h2>
      <select id="viz-select"></select>
      <div class="status" id="viz-desc"></div>
      <div id="param-form"></div>
      <div class="row">
        <button class="secondary" id="reset-params" title="Reset every parameter to the visualizer's defaults">Reset all</button>
      </div>
      <h2 style="margin-top:14px">Explore</h2>
      <label>Exploration seed <span class="hint">(same seed → same result)</span></label>
      <div class="row">
        <input type="number" id="explore-seed" value="1" min="0" step="1"/>
        <button class="secondary" id="randomize-btn" title="Deterministically randomize all randomizable parameters">Randomize</button>
        <button class="secondary" id="mutate-btn" title="Deterministically nudge randomizable parameters around their current values">Mutate</button>
      </div>
      <div class="status" id="explore-status"></div>
    </div>

    <div class="section">
      <h2>Presets</h2>
      <select id="preset-select"><option value="">— saved presets —</option></select>
      <div class="row">
        <button class="secondary" id="preset-load">Load</button>
        <button class="secondary" id="preset-save">Save…</button>
      </div>
      <div class="row">
        <button class="secondary" id="preset-export" title="Download the current state as a preset JSON file">Export</button>
        <label class="file-btn secondary" title="Load a preset JSON from disk">Import<input type="file" id="preset-import" accept=".json" hidden /></label>
        <button class="secondary" id="copy-cmd" title="Copy the CLI command that reproduces this exact render">Copy cmd</button>
      </div>
      <div class="status" id="preset-status"></div>
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
      <label>Capture mode <span class="hint">(canvas is faster, screenshot is the reliable fallback)</span></label>
      <select id="r-capture">
        <option value="auto">auto (canvas, falls back to screenshot)</option>
        <option value="canvas">canvas (fast)</option>
        <option value="screenshot">screenshot (reliable)</option>
      </select>
      <div class="row">
        <button id="render-btn">Render video</button>
        <button class="secondary" id="still-btn" title="Save the current frame as a PNG at the render resolution">Capture still</button>
      </div>
      <div class="status" id="render-status"></div>
      <details id="render-history-box">
        <summary>Render history</summary>
        <div id="render-history" class="history"></div>
      </details>
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
        <label for="audio-mode" style="margin:0">audio</label>
        <select id="audio-mode">
          <option value="off">off</option>
          <option value="synth">simple synth</option>
        </select>
      </div>
      <div class="time" id="time-label">0.00 / 0.00s</div>
    </div>
    <details class="inspector" id="inspector-box">
      <summary>Timeline inspector</summary>
      <div id="inspector" class="inspector-grid"></div>
    </details>
  </div>
`;

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;

const viewport = $("viewport");
const playBtn = $<HTMLButtonElement>("play-btn");
const seek = $<HTMLInputElement>("seek");
const timeLabel = $("time-label");

function setStatus(id: string, msg: string, cls: "" | "error" | "ok" = "") {
  const el = $(id);
  el.textContent = msg;
  el.className = `status ${cls}`;
}

function currentRenderSettings(): RenderSettings {
  return {
    fps: Number($<HTMLInputElement>("r-fps").value) || 30,
    width: Number($<HTMLInputElement>("r-w").value) || 1920,
    height: Number($<HTMLInputElement>("r-h").value) || 1080,
    name: ($<HTMLInputElement>("r-name").value || "render")
      .replace(/[^a-zA-Z0-9._-]/g, "_"),
    capture: ($<HTMLSelectElement>("r-capture").value as RenderSettings["capture"]) || "auto",
  };
}

// ---------------------------------------------------------------------------
// Timeline loading
// ---------------------------------------------------------------------------

function loadTimeline(timeline: Timeline, path: string | null, label: string) {
  state.timeline = timeline;
  state.timelinePath = path;
  state.engine = new TimingEngine(timeline);
  state.annotations = null;
  state.t = 0;
  stopPlayback();
  audio.setEngine(state.engine);
  playBtn.disabled = false;
  setStatus("timeline-status", `loaded: ${label}`, "ok");
  renderMetaTable(timeline);
  rebuildVisualizer();
  setStatus("render-status", path ? "" : "local-only timeline: preview works, rendering needs the backend");
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
  // Auto-load a sidecar annotations file if one sits next to the timeline.
  try {
    const annRes = await fetch(`/${path.replace(/\.timeline\.json$/, ".annotations.json")}`);
    if (annRes.ok) {
      state.annotations = parseAnnotations(await annRes.json());
      setStatus("timeline-status",
        `loaded: ${path.split("/").pop()} (+${state.annotations.labels.length} annotations)`, "ok");
      rebuildVisualizer();
    }
  } catch { /* no sidecar — fine */ }
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

// Timeline JSON upload: saved through the backend into output/uploads/ so
// the render pipeline can reference it by server-side path (first-pass
// limitation fixed). Falls back to preview-only if the backend is down.
$<HTMLInputElement>("json-file").addEventListener("change", async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  let timeline: Timeline;
  try {
    timeline = JSON.parse(await file.text()) as Timeline;
    if (timeline.format !== "midicore-timeline") {
      throw new Error("not a midicore timeline JSON");
    }
  } catch (err) {
    setStatus("timeline-status", `load failed: ${err}`, "error");
    return;
  }
  try {
    const res = await fetch(`/api/upload-timeline?name=${encodeURIComponent(file.name)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(timeline),
    });
    if (!res.ok) throw new Error(await res.text());
    const { path } = await res.json();
    loadTimeline(timeline, path, `${file.name} (uploaded)`);
  } catch {
    loadTimeline(timeline, null, `${file.name} (local only)`);
  }
});

$<HTMLInputElement>("annotations-file").addEventListener("change", async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    state.annotations = parseAnnotations(JSON.parse(await file.text()));
    setStatus("timeline-status",
      `annotations loaded: ${state.annotations.labels.length} labels`, "ok");
    rebuildVisualizer();
  } catch (err) {
    setStatus("timeline-status", `annotations failed: ${err}`, "error");
  }
});

// ---------------------------------------------------------------------------
// Visualizer selection & adaptive params
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

function selectVisualizer(id: string, params?: ParamValues) {
  const def = getVisualizer(id);
  if (!def) return;
  state.vizDef = def;
  state.params = params ? sanitizeParams(def, params) : defaultParams(def);
  $<HTMLSelectElement>("viz-select").value = id;
  $("viz-desc").innerHTML =
    `${def.description} <span class="badge ${def.status}">${def.status}</span>`;
  paramPanel = new ParamPanel($("param-form"), def, state.params, (key, value) => {
    state.params[key] = value;
    // Rebuild instead of patching: cheap at these scene sizes and guarantees
    // preview == render for any parameter.
    rebuildVisualizer();
  });
  rebuildVisualizer();
}

/** Apply a whole new param set (randomize/mutate/preset/reset). */
function applyParams(params: ParamValues) {
  if (!state.vizDef) return;
  state.params = sanitizeParams(state.vizDef, params);
  paramPanel?.setValues(state.params);
  rebuildVisualizer();
}

$("reset-params").addEventListener("click", () => {
  if (!state.vizDef) return;
  applyParams(defaultParams(state.vizDef));
  setStatus("explore-status", "reset to defaults");
});

$("randomize-btn").addEventListener("click", () => {
  if (!state.vizDef) return;
  const seedInput = $<HTMLInputElement>("explore-seed");
  const seed = Math.floor(Number(seedInput.value) || 0);
  applyParams(randomizeParams(state.vizDef, state.params, seed));
  // Auto-advance so repeated clicks explore; the used seed is reported so
  // any result can be reproduced by typing it back in.
  seedInput.value = String(seed + 1);
  setStatus("explore-status", `randomized with seed ${seed} (reproducible)`);
});

$("mutate-btn").addEventListener("click", () => {
  if (!state.vizDef) return;
  const seedInput = $<HTMLInputElement>("explore-seed");
  const seed = Math.floor(Number(seedInput.value) || 0);
  applyParams(mutateParams(state.vizDef, state.params, seed));
  seedInput.value = String(seed + 1);
  setStatus("explore-status", `mutated with seed ${seed} (reproducible)`);
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
    annotations: state.annotations ?? undefined,
  });
  state.viz.renderAtTime(state.t);
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

interface PresetListEntry { file: string; name: string; visualizer: string; }

async function refreshPresets() {
  try {
    const res = await fetch("/api/presets");
    if (!res.ok) return;
    const list: PresetListEntry[] = await res.json();
    const select = $<HTMLSelectElement>("preset-select");
    const current = select.value;
    select.innerHTML = `<option value="">— saved presets —</option>`;
    for (const p of list) {
      const opt = document.createElement("option");
      opt.value = p.file;
      opt.textContent = `${p.name} (${p.visualizer})`;
      select.appendChild(opt);
    }
    select.value = current;
  } catch { /* backend down; preset UI just stays empty */ }
}

function currentPreset(name: string, note?: string): Preset {
  return makePreset({
    name,
    visualizer: state.vizDef?.id ?? "",
    params: state.params,
    render: currentRenderSettings(),
    timeline: state.timelinePath,
    note,
  });
}

function applyPreset(preset: Preset) {
  const def = getVisualizer(preset.visualizer);
  if (!def) {
    setStatus("preset-status",
      `preset needs visualizer "${preset.visualizer}" which is not installed`, "error");
    return;
  }
  selectVisualizer(def.id, preset.params);
  if (preset.render) {
    $<HTMLInputElement>("r-fps").value = String(preset.render.fps ?? 30);
    $<HTMLInputElement>("r-w").value = String(preset.render.width ?? 1920);
    $<HTMLInputElement>("r-h").value = String(preset.render.height ?? 1080);
    $<HTMLInputElement>("r-name").value = preset.render.name ?? "render";
    $<HTMLSelectElement>("r-capture").value = preset.render.capture ?? "auto";
  }
  setStatus("preset-status",
    `loaded "${preset.name}"${preset.note ? ` — ${preset.note}` : ""}`
    + (preset.timeline && preset.timeline !== state.timelinePath
      ? `\n(authored against ${preset.timeline})` : ""), "ok");
}

$("preset-save").addEventListener("click", async () => {
  if (!state.vizDef) return;
  const name = prompt("Preset name:", `${state.vizDef.id}-preset`);
  if (!name) return;
  const note = prompt("Optional note/description:") ?? undefined;
  try {
    const res = await fetch("/api/presets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(currentPreset(name, note)),
    });
    if (!res.ok) throw new Error(await res.text());
    const { file } = await res.json();
    await refreshPresets();
    $<HTMLSelectElement>("preset-select").value = file;
    setStatus("preset-status", `saved presets/${file}`, "ok");
  } catch (err) {
    setStatus("preset-status", `save failed: ${err} (backend running?)`, "error");
  }
});

$("preset-load").addEventListener("click", async () => {
  const file = $<HTMLSelectElement>("preset-select").value;
  if (!file) return;
  try {
    const res = await fetch(`/api/presets/${encodeURIComponent(file)}`);
    if (!res.ok) throw new Error(await res.text());
    applyPreset(parsePreset(await res.json()));
  } catch (err) {
    setStatus("preset-status", `load failed: ${err}`, "error");
  }
});

$("preset-export").addEventListener("click", () => {
  if (!state.vizDef) return;
  const preset = currentPreset(`${state.vizDef.id}-export`);
  download(
    `${preset.name}.preset.json`,
    new Blob([JSON.stringify(preset, null, 2)], { type: "application/json" }),
  );
  setStatus("preset-status", "exported preset JSON");
});

$<HTMLInputElement>("preset-import").addEventListener("change", async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try {
    applyPreset(parsePreset(JSON.parse(await file.text())));
  } catch (err) {
    setStatus("preset-status", `import failed: ${err}`, "error");
  }
});

$("copy-cmd").addEventListener("click", async () => {
  if (!state.vizDef) return;
  const cmd = buildRenderCommand({
    timeline: state.timelinePath,
    visualizer: state.vizDef.id,
    params: state.params,
    render: currentRenderSettings(),
  });
  try {
    await navigator.clipboard.writeText(cmd);
    setStatus("preset-status", `copied:\n${cmd}`, "ok");
  } catch {
    setStatus("preset-status", cmd); // clipboard blocked: show it instead
  }
});

function download(filename: string, blob: Blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
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
  updateInspector();
});

$<HTMLSelectElement>("audio-mode").addEventListener("change", (e) => {
  audio.mode = (e.target as HTMLSelectElement).value as "off" | "synth";
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
// Still capture — renders the current timestamp at the FULL render
// resolution into a detached canvas, so stills match final render pixels
// (cumulative visualizers make great posters this way).
// ---------------------------------------------------------------------------

$("still-btn").addEventListener("click", () => {
  if (!state.engine || !state.vizDef) {
    setStatus("render-status", "load a timeline first", "error");
    return;
  }
  const { width, height, name } = currentRenderSettings();
  const holder = document.createElement("div"); // never attached to the DOM
  let inst: VisualizerInstance | null = null;
  try {
    inst = state.vizDef.create({
      container: holder,
      width, height,
      engine: state.engine,
      params: { ...state.params },
      annotations: state.annotations ?? undefined,
    });
    inst.renderAtTime(state.t);
    const canvas = holder.querySelector("canvas");
    if (!canvas) throw new Error("visualizer produced no canvas");
    canvas.toBlob((blob) => {
      if (!blob) {
        setStatus("render-status", "still capture failed (toBlob returned null)", "error");
        return;
      }
      download(`${name}-${state.vizDef!.id}-${state.t.toFixed(2)}s.png`, blob);
      setStatus("render-status",
        `still captured at t=${state.t.toFixed(2)}s (${width}x${height})`, "ok");
    }, "image/png");
  } catch (err) {
    setStatus("render-status", `still capture failed: ${err}`, "error");
  } finally {
    inst?.dispose();
  }
});

// ---------------------------------------------------------------------------
// Timeline inspector — musical state at the playhead, straight from the
// timing engine. Debugging + creative understanding, updated 4x/second.
// ---------------------------------------------------------------------------

function updateInspector() {
  const box = $<HTMLDetailsElement>("inspector-box");
  if (!box.open || !state.engine) return;
  const e = state.engine;
  const t = Math.min(state.t, e.durationSeconds - 1e-6);
  const active = e.notesActiveAt(t);
  const held = e.notesHeldAt(t);
  const sustained = e.notesSustainedAt(t);
  const starting = e.notesStartingBetween(t - 0.5, t + 0.5);
  const { bar, beat } = e.barBeatAt(t);
  const tempo = e.tempoAt(t);

  // Active tracks/instruments summary.
  const byTrack = new Map<number, number>();
  for (const n of active) byTrack.set(n.track, (byTrack.get(n.track) ?? 0) + 1);
  const trackSummary = [...byTrack.entries()]
    .map(([tr, count]) => {
      const info = state.timeline?.tracks[tr];
      const label = info?.name || info?.programs[0]?.name || `track ${tr}`;
      return `${label}: ${count}`;
    })
    .join(" · ") || "—";

  const noteNames = (ns: typeof active) =>
    ns.slice(0, 12).map((n) => n.name).join(" ") + (ns.length > 12 ? " …" : "") || "—";

  const drift = audio.driftSeconds(state.t);
  const labels = state.annotations?.labelsAt(t) ?? [];

  const rows: [string, string][] = [
    ["time", `${t.toFixed(3)} s`],
    ["bar / beat", `${bar} / ${beat.toFixed(2)}`],
    ["tempo", `${tempo.bpm.toFixed(1)} BPM`],
    ["active (sounding)", String(active.length)],
    ["held (key down)", String(held.length)],
    ["sustain-only", String(sustained.length)],
    ["starting ±0.5s", noteNames(starting)],
    ["active tracks", trackSummary],
    ["audio sync", drift === null ? "audio off / stopped"
      : `${(drift * 1000).toFixed(1)} ms (audio − visual)`],
    ...(state.annotations
      ? [["annotations", labels.map((l) => l.name).join(", ") || "—"] as [string, string]]
      : []),
  ];
  $("inspector").innerHTML = rows
    .map(([k, v]) => `<div class="ins-k">${k}</div><div class="ins-v">${v}</div>`)
    .join("");
}
setInterval(updateInspector, 250);

// ---------------------------------------------------------------------------
// Render job launch + polling + history
// ---------------------------------------------------------------------------

$("render-btn").addEventListener("click", async () => {
  if (!state.timelinePath || !state.vizDef || !state.engine) {
    setStatus("render-status", "load a server-side timeline first", "error");
    return;
  }
  const r = currentRenderSettings();
  const frames = frameCount(state.engine.durationSeconds, r.fps, 1.5);
  const body = {
    timeline: state.timelinePath,
    visualizer: state.vizDef.id,
    // The EXACT preview params go into the render job — preview == render.
    params: state.params,
    fps: r.fps,
    width: r.width,
    height: r.height,
    name: r.name,
    capture: r.capture,
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
        setStatus("render-status",
          `done!${job.outDir ? `\noutput: ${job.outDir}` : ""}\n${tail}`, "ok");
        void refreshHistory();
      } else if (job.status === "failed") {
        clearInterval(timer);
        setStatus("render-status", `render failed:\n${tail}`, "error");
        void refreshHistory();
      } else {
        setStatus("render-status", tail);
      }
    } catch {
      clearInterval(timer);
      setStatus("render-status", "lost contact with backend", "error");
    }
  }, 1500);
}

interface HistoryEntry {
  dir: string;
  name?: string;
  visualizer?: string;
  finishedAt?: string;
  totalFrames?: number;
  fps?: number;
  width?: number;
  height?: number;
  status?: string;
  command?: string;
  captureMode?: string;
  captureFps?: number;
}

async function refreshHistory() {
  try {
    const res = await fetch("/api/renders");
    if (!res.ok) return;
    const entries: HistoryEntry[] = await res.json();
    const el = $("render-history");
    if (!entries.length) {
      el.innerHTML = `<div class="status">no renders yet</div>`;
      return;
    }
    el.innerHTML = entries.map((r) => `
      <div class="history-item">
        <div class="history-title">${r.name ?? r.dir}
          <span class="badge ${r.status === "failed" ? "dev" : "final"}">${r.status ?? "done"}</span>
        </div>
        <div class="history-meta">
          ${r.visualizer ?? "?"} · ${r.width ?? "?"}x${r.height ?? "?"}@${r.fps ?? "?"}fps
          · ${r.totalFrames ?? "?"} frames
          ${r.captureMode ? `· ${r.captureMode}${r.captureFps ? ` @ ${r.captureFps.toFixed(1)} cap-fps` : ""}` : ""}
        </div>
        <div class="history-meta">${r.dir}</div>
        ${r.command ? `<button class="secondary tiny" data-cmd="${encodeURIComponent(r.command)}">copy command</button>` : ""}
      </div>`).join("");
    for (const btn of el.querySelectorAll<HTMLButtonElement>("button[data-cmd]")) {
      btn.addEventListener("click", () =>
        navigator.clipboard.writeText(decodeURIComponent(btn.dataset.cmd!)));
    }
  } catch { /* backend down */ }
}
$<HTMLDetailsElement>("render-history-box").addEventListener("toggle", (e) => {
  if (($<HTMLDetailsElement>("render-history-box")).open) void refreshHistory();
});

// ---------------------------------------------------------------------------

populateVizSelect();
void fetchSamples();
void refreshPresets();
requestAnimationFrame(tick);
