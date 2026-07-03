# Developer Guide

This is the deep documentation for the MIDI visualizer system. The README
covers install/quick-run; this covers how the system is built and how to
extend it.

Contents:
1. [Architecture overview](#architecture-overview)
2. [MIDI parser usage](#midi-parser-usage)
3. [Timeline JSON](#timeline-json)
4. [Timing engine usage](#timing-engine-usage)
5. [Visualizer interface](#visualizer-interface)
6. [Visualizer parameters](#visualizer-parameters)
7. [Creating a new visualizer](#creating-a-new-visualizer)
8. [Promoting dev → final](#promoting-dev--final)
9. [Render pipeline](#render-pipeline)
10. [Audio rendering](#audio-rendering)
11. [The gallery](#the-gallery)

Related guides: [STUDIO.md](STUDIO.md) (studio controls, presets,
exploration tools) · [CREATIVE_WORKFLOW.md](CREATIVE_WORKFLOW.md) (how to
develop visualizer ideas) · [ANNOTATIONS.md](ANNOTATIONS.md) (musical
label sidecars) · [AUDIO_SETUP.md](AUDIO_SETUP.md) (FluidSynth/SoundFont).

---

## Architecture overview

The system is three cooperating parts joined by **one interchange format**,
the timeline JSON:

```
┌─────────────┐   timeline JSON   ┌──────────────────────────────┐
│  midicore    │ ────────────────▶ │  studio (Vite + TS + Three)  │
│  (Python)    │                   │  · TimingEngine (TS twin)    │
│  · parser    │                   │  · visualizer registry       │
│  · timing    │                   │  · index.html  = studio UI   │
│  · CLI       │                   │  · render.html = frame target│
└─────────────┘                   └──────────────┬───────────────┘
                                                  │ window.__viz API
                                   ┌──────────────▼───────────────┐
                                   │  renderer (Node)             │
                                   │  · server.js  dev backend    │
                                   │  · render.js  Playwright +   │
                                   │               ffmpeg          │
                                   └──────────────────────────────┘
```

Key decisions and why:

- **Parsing lives in Python (mido), once.** The browser never parses MIDI.
  When you upload a `.mid` in the studio, the Node backend shells out to
  `python -m midicore parse` and returns the JSON. One parser, one truth.
- **The timing engine exists twice, deliberately.** `midicore/timing.py`
  (for CLI/analysis/tests) and `studio/src/core/timing-engine.ts` (for
  the browser). They implement identical semantics and share mirrored test
  suites — the duplication is the price of not forcing Python into the
  browser or a JS runtime into the CLI. If you change one, change both.
- **Preview and final render run the exact same code.** The studio page and
  the render page both instantiate visualizers from the same registry and
  drive them through the same `TimingEngine`. Only the clock differs:
  the studio uses a wall clock for playback; the renderer uses
  `t = frame / fps`.
- **Determinism is a contract, not a hope.** A visualizer's
  `renderAtTime(t)` must be a pure function of `t` (see interface docs
  below). That is what makes offline rendering, seeking, and reproducible
  output possible.
- **ffmpeg via `ffmpeg-static`.** The npm package ships a real ffmpeg
  binary, so Windows users don't need a manual install. A system ffmpeg on
  PATH is the fallback.

## MIDI parser usage

```powershell
# venv python has midicore installed
midicore\.venv\Scripts\python -m midicore parse song.mid                  # -> song.timeline.json
midicore\.venv\Scripts\python -m midicore parse song.mid -o out.json --pretty
midicore\.venv\Scripts\python -m midicore parse song.mid --csv --jsonl    # flat exports too
midicore\.venv\Scripts\python -m midicore validate out.json
midicore\.venv\Scripts\python -m midicore info out.json --at 12.5         # state at t=12.5s
midicore\.venv\Scripts\python -m midicore samples --out samples           # regenerate demo MIDIs
midicore\.venv\Scripts\python -m midicore schema -o docs\timeline.schema.json
```

Or from Python:

```python
from midicore import parse_midi, TimelineQuery, validate_timeline
timeline = parse_midi("song.mid")
assert validate_timeline(timeline) == []
q = TimelineQuery(timeline)
q.notes_active_at(3.0)
```

What the parser handles (see `midicore/parser.py` for the commented
implementation):

- note-on/note-off pairing, including **note-on with velocity 0 as
  note-off**, and FIFO pairing for overlapping notes of the same pitch;
- **tempo maps** — tick→seconds conversion walks every `set_tempo` change;
- **time signatures** — every note gets a bar/beat position;
- **sustain pedal (CC64)** — value ≥ 64 is down, < 64 is up, merged per
  channel across tracks. Each note carries both its *explicit* (key-held)
  and *sounding* (pedal-extended) end. Files without pedal data simply get
  `has_sustain_data: false` and identical explicit/sounding values.
  Raw CC64 **values are preserved** in `sustain_events` (half-pedal levels
  survive; only the down/up decision binarizes at the ≥64 threshold —
  half-pedaling as a *sound* effect is not modeled);
- **re-strikes** — striking a pitch again while its previous note is still
  ringing in the pedal cuts the earlier note's sounding tail at the new
  attack (like a real piano hammer re-using the string). Such notes are
  flagged `restruck: true` (format_version 1.1, purely additive);
- **SMPTE-timebase files are rejected** with a clear
  `SMPTETimebaseError` — their wall-clock division would silently break
  tempo math, and PPQ files are the overwhelming norm. Re-export with
  musical timing if you hit this;
- unterminated notes (missing note-off) are closed at end-of-file and
  flagged;
- track names, channels, GM program/instrument names.

CSV/JSONL exports are optional flattenings of the note table for
spreadsheet/pandas work — the JSON is always the canonical format.

## Timeline JSON

Documented field-by-field in [SCHEMA.md](SCHEMA.md); MIDI concepts
explained for non-MIDI people in [GLOSSARY.md](GLOSSARY.md); machine-readable
JSON Schema in [timeline.schema.json](timeline.schema.json).

Top-level shape:

```json
{
  "format": "midicore-timeline",
  "format_version": "1.1",
  "meta": { "duration_seconds": 29.09, "ticks_per_beat": 480, ... },
  "tempo_map": [ { "tick": 0, "seconds": 0.0, "bpm": 66.0, ... } ],
  "time_signature_map": [ { "tick": 0, "numerator": 4, "denominator": 4, "bar": 1, ... } ],
  "tracks": [ { "index": 0, "name": "...", "programs": [...], ... } ],
  "sustain_events": [ { "seconds": 0.0, "value": 127, "pedal_down": true, ... } ],
  "notes": [ { "pitch": 60, "name": "C4", "start_seconds": 0.0,
               "end_seconds_explicit": 0.25, "end_seconds_sounding": 3.63, ... } ]
}
```

## Timing engine usage

Never read `timeline.notes` and do time math in a visualizer — ask the
engine. TS and Python expose the same queries:

| Question | TypeScript | Python |
|---|---|---|
| piece length | `engine.durationSeconds` | `q.duration_seconds` |
| sounding at t (incl. pedal tails) | `notesActiveAt(t)` | `notes_active_at(t)` |
| key held at t | `notesHeldAt(t)` | `notes_held_at(t)` |
| pedal-only at t | `notesSustainedAt(t)` | `notes_sustained_at(t)` |
| starting in [t0,t1) | `notesStartingBetween(t0,t1)` | `notes_starting_between(t0,t1)` |
| ending in [t0,t1) | `notesEndingBetween(t0,t1,sounding)` | `notes_ending_between(t0,t1,sounding)` |
| tempo at t | `tempoAt(t)` | `tempo_at(t)` |
| bar/beat at t | `barBeatAt(t)` | `bar_beat_at(t)` |
| grouped notes | `notesByTrack/Channel/Instrument()` | `notes_by_track/channel/instrument()` |
| frame timestamp | `frameTime(n, fps)` (frame-math.ts) | `TimelineQuery.frame_time(n, fps)` |

All intervals are **half-open `[start, end)`**: a note ending exactly at
`t` is not active at `t`. This avoids double-counting at frame boundaries.

## Visualizer interface

A visualizer is a folder under `studio/src/visualizers/dev/<id>/` or
`.../final/<id>/` whose `index.ts` default-exports a `VisualizerDefinition`
(see `studio/src/visualizers/types.ts`):

```ts
{
  id: "my-viz",              // unique, used by CLI --visualizer
  name: "My Viz",
  description: "…",
  renderMode: "2d" | "3d" | "both",
  params: [ /* ParamSpec[], see "Visualizer parameters" below */ ],
  create(ctx) => VisualizerInstance
}
```

`create` receives a `VisualizerContext`:

- `container` — an empty element; append your own canvas (2D context,
  WebGL/Three.js, anything). This is what keeps the interface open to
  future shader/particle/3D experiments.
- `width` / `height` — output pixel size. Treat 1920×1080 as the design
  reference and scale internally (see `DESIGN_HEIGHT` in
  circular-accumulator) so previews match renders.
- `engine` — the `TimingEngine`.
- `params` — resolved parameter values (defaults merged with overrides).
- `annotations` — optional `AnnotationSet` when a sidecar was loaded
  (see [ANNOTATIONS.md](ANNOTATIONS.md)); may be `undefined`.

The returned `VisualizerInstance` must implement:

- `renderAtTime(t)` — draw the complete state for time `t`. **Must be a
  pure function of `t`:** any `t`, any order, seeking backward included,
  same image. No accumulated per-frame state that depends on call order,
  no `Date.now()`, no unseeded `Math.random()` (seeded/deterministic noise
  is fine).
- `dispose()` — release GPU resources, remove the canvas.
- optional `resize(w, h)`, `setParams(params)`.

Discovery is automatic: `registry.ts` uses Vite's
`import.meta.glob("./{dev,final}/*/index.ts", { eager: true })`. No central
list to edit; the folder *is* the registration. Status (`dev`/`final`) is
derived from the folder path, so it can never lie.

## Visualizer parameters

Each entry in `params` is a `ParamSpec`
(`studio/src/visualizers/types.ts`); the studio generates its whole
control panel from these — visualizers never write UI code.

```ts
{
  key: "noiseStrength",          // params object key
  label: "Noise strength (px)",  // control label
  type: "number",                // see the type table below
  default: 26,
  min: 0, max: 120, step: 1,     // number/seed/vec/range bounds
  options: ["a", "b"],           // select only
  description: "…",              // tooltip in the studio
  group: "Motion",               // collapsible section (default "General")
  advanced: true,                // hidden behind the "show advanced" toggle
  randomizable: true,            // opt-in for Randomize/Mutate
}
```

| type | value shape | studio control |
|---|---|---|
| `number` | number | slider + numeric input (slider only when min & max given) |
| `color` | `"#rrggbb"` | color picker |
| `boolean` | boolean | checkbox |
| `select` | one of `options` | dropdown |
| `vec2` / `vec3` | `[x,y]` / `[x,y,z]` | 2–3 numeric inputs |
| `range` | `[min,max]` (kept ordered) | numeric pair |
| `seed` | non-negative integer | integer input + 🎲 new-seed button |

The v1 schema (`number`/`color`/`boolean`/`select`, no group/flags) is a
strict subset — old visualizers work unchanged.

Conventions that make the exploration tools useful:

- mark a param `randomizable` **only** if a random value can look
  intentional (colors, rates, noise settings — yes; direction, structural
  radii, background — usually no);
- anything using noise/randomness must expose a `seed` param and derive
  ALL randomness from it (`mulberry32`/`hashString` in
  `studio/src/visualizers/params.ts`; `createNoise3D(mulberry32(seed))`
  for simplex noise). Unseeded `Math.random()` in render code is a bug;
- group related params; put niche ones behind `advanced`.

Presets (`presets/*.preset.json`, managed from the studio or by hand)
store `{visualizer, params, render, timeline, created_at, note}` — see
[STUDIO.md](STUDIO.md).

## Creating a new visualizer

1. Copy `studio/src/visualizers/dev/pitch-roll/` to
   `studio/src/visualizers/dev/my-viz/` (it is the minimal 2D template;
   `final/circular-accumulator/` is the Three.js mesh template;
   `dev/noise-orbit-particles/` is the particles + seeded-noise template).
   For the idea-to-implementation process, read
   [CREATIVE_WORKFLOW.md](CREATIVE_WORKFLOW.md).
2. Change `id`, `name`, `description`, params, and the drawing code.
3. `npm run dev` — it appears in the studio dropdown with a `[dev]` badge.
4. Preview against `samples/sustain_demo.timeline.json` (exercises pedal
   tails) and `samples/tempo_change.timeline.json` (exercises tempo maps).
5. Test-render:
   `npm run render -- --timeline samples/scale.timeline.json --visualizer my-viz --fps 15 --width 640 --height 360`

Colors: pull from `studio/src/visualizers/palette.ts` (the centralized
palette) and/or expose `color` params.

## Promoting dev → final

Move the folder:

```powershell
git mv studio/src/visualizers/dev/my-viz studio/src/visualizers/final/my-viz
```

That's the whole workflow. The registry re-derives status from the path;
the studio sorts final visualizers first; nothing else changes. Keep dev
visualizers experimental and cheap — they ship in the same bundle but are
clearly badged.

## Render pipeline

`renderer/render.js` (also reachable as `npm run render --`):

```powershell
npm run render -- --timeline samples/prelude_c.timeline.json `
  --visualizer circular-accumulator `
  --fps 30 --width 1920 --height 1080 `
  --name prelude --tail 1.5 `
  --params "{""colorMode"":""track""}" `
  --capture auto `
  --keep-frames --audio --midi samples/prelude_c.mid
```

Steps performed (all commented in the script):

1. Builds `studio/dist` if missing (`vite build studio`).
2. Serves `dist` on an ephemeral localhost port.
3. Launches headless Chromium via Playwright at exactly
   `--width × --height`, device scale factor forced to 1, sRGB.
4. Loads `render.html`, calls `window.__viz.load({timeline, visualizerId,
   params, width, height, annotations})` (annotation sidecars are
   auto-loaded from next to the timeline).
5. For each frame `f` in `0 .. ceil((duration + tail) * fps)`:
   `t = f / fps` → draw + capture `frames/frame_%06d.png`.
6. ffmpeg: `-framerate fps -i frame_%06d.png -c:v libx264 -crf 18
   -pix_fmt yuv420p name.mp4`.
7. Optionally renders/muxes audio (next section).
8. Writes `render-info.json` (full settings + measured capture rate +
   the reproduction command), then **deletes the frames** unless
   `--keep-frames`.

### Capture modes (`--capture`, default `auto`)

| mode | how a frame becomes a PNG | tradeoff |
|---|---|---|
| `canvas` | `renderAtTime(t)` then `canvas.toDataURL("image/png")` in-page; Node decodes the base64 and writes the file | **~2–4× faster**: no compositor wait (rAFs) and no CDP screenshot round-trip. Requires the visualizer to draw ONE full-size canvas, and WebGL contexts to set `preserveDrawingBuffer: true` (all bundled visualizers comply) |
| `screenshot` | `renderFrame(t)` (two rAFs so the frame is presented) then Playwright `page.screenshot` | slower, but captures whatever the page shows — works for multi-canvas/DOM-overlay experiments. The reliable fallback |
| `auto` | probes `canvas` once on frame 0 (checks it returns a PNG at exactly the target size); any problem → falls back to `screenshot` with a log line | use this unless debugging |

Both paths capture the SAME deterministic `t = frame / fps` state — mode
changes speed, never content. The resolved mode and measured capture fps
are logged and recorded in `render-info.json`.

Output structure per render job:

```
output/renders/<name>-<timestamp>/
  frames/            (only with --keep-frames)
  <name>.mp4         silent video — always produced
  <name>.wav         (only if audio rendering succeeded)
  <name>_audio.mp4   (only if audio rendering succeeded)
  render-info.json   settings + timing record
```

Frame-count sanity: a 10-minute piece at 30 fps is ~18 000 PNGs, roughly
a few GB at 1080p. They live only inside the job directory, are deleted by
default after encoding, and the whole `output/` tree is gitignored. To
reclaim space: delete old `output/renders/*` directories, nothing else
references them.

Defaults (fps 30, 1920×1080, tail 1.5 s, output dir) are configurable in
`config/project.config.json` and overridable per run with flags. The
studio's Render panel posts the same parameters to the backend, which
spawns this same script — CLI and studio are the same pipeline.

## Audio rendering

**MIDI is not audio** — rendering sound needs a synthesizer (FluidSynth)
plus a SoundFont. Full setup, the exact commands used, and
troubleshooting live in **[AUDIO_SETUP.md](AUDIO_SETUP.md)**; verify your
setup any time with:

```powershell
npm run check:audio
```

**Failure policy:** audio is strictly best-effort. If FluidSynth or the
SoundFont is missing or errors, the reason is logged (`AUDIO SKIPPED: …`)
and the silent MP4 remains the valid deliverable. Silent rendering never
depends on any audio dependency.

The studio's play-preview audio is a different thing entirely: a tiny
built-in Web Audio synth (`studio/src/studio/audio-preview.ts`),
synchronized to the same timeline clock — useful for checking sync, not
representative of final audio quality.

## The gallery

`gallery/` is a deliberately isolated static page for showing finished
work (rendered MP4s, stills, notes). It has **no build step and no access
to the pipeline** — it just reads `gallery/manifest.json` and displays
files you copied into `gallery/media/`. See `gallery/README.md`.

```powershell
npm run gallery     # serves http://localhost:8899 via python http.server
```
