# Studio Guide — controls, presets, exploration tools

`npm run dev` → http://localhost:5173. The left sidebar is organized
top-to-bottom in workflow order: Timeline → Visualizer → Presets → Render.

## Timeline panel

- **Sample piece** — the generated demos in `samples/` (served by the
  backend). Picking one also auto-loads a `*.annotations.json` sidecar if
  present.
- **Upload MIDI** — parsed server-side by the Python parser, stored under
  `output/uploads/`, immediately renderable.
- **Upload timeline JSON** — a pre-parsed `.timeline.json`; it is copied
  through the backend into `output/uploads/` so it can be **rendered**,
  not just previewed. (Falls back to preview-only if the backend is down.)
- **Annotations** — load any annotation sidecar manually
  (see [ANNOTATIONS.md](ANNOTATIONS.md)).

## Visualizer panel (adaptive controls)

The parameter UI is generated from each visualizer's own schema — nothing
here is specific to any visualizer:

- **Groups** are collapsible sections (`Layout`, `Motion`, `Color`, …).
- **Sliders** have a live numeric input beside them; hover a label for its
  tooltip.
- **↺** next to a label resets that one parameter (appears only when it
  differs from the default). **Reset all** resets the whole visualizer.
- **show advanced parameters** reveals controls flagged `advanced`.
- **vec2/vec3/range/seed** controls render as component inputs; seed
  params get a 🎲 button for a fresh (but recorded) seed.

Every change rebuilds the preview immediately, and the exact same params
are sent to renders — what you preview is what you render.

### Explore: Randomize / Mutate

- **Randomize** re-rolls every parameter the visualizer marked
  `randomizable` (structural params are untouched).
- **Mutate** nudges those parameters around their current values —
  for refining a look you almost like.
- Both are **deterministic in the exploration seed**: the status line
  reports "randomized with seed N", and typing N back in reproduces that
  exact result. The seed auto-advances after each click so repeated
  clicking keeps exploring.
- Found something good? **Save it as a preset immediately.**

## Presets panel

A preset stores: visualizer id, all params, render settings (fps,
resolution, name, capture mode), the timeline path it was authored
against, a timestamp, and an optional note.

- **Save…** — writes `presets/<name>.preset.json` via the backend
  (small, diffable, committable files).
- **Load** — applies the selected preset: switches visualizer, params,
  and render settings. If it was authored against a different timeline,
  the status line says so (params still apply).
- **Export / Import** — the same JSON as a file download/upload, for
  sharing outside the repo.
- **Copy cmd** — copies the exact CLI equivalent
  (`node renderer/render.js --timeline … --params '…'`) of the current
  state to the clipboard. CLI parity in one click.

## Render panel

- FPS / width / height / output name / **capture mode**
  (`auto` probes the fast canvas path, falls back to `screenshot`; see
  [GUIDE.md → Render pipeline](GUIDE.md#render-pipeline)).
- **Render video** — spawns `renderer/render.js` as a backend job; the
  status area streams the log tail (frame progress, capture rate, output
  path, clear failure messages).
- **Capture still** — saves the *current preview frame* as a PNG **at the
  configured render resolution** (a fresh instance is rendered off-screen
  at full size, so the still matches final-render pixels). Ideal for
  cumulative visualizers: scrub to the end, capture, done — no video
  render needed for a poster frame.
- **Render history** — expandable list built from
  `output/renders/*/render-info.json` (plus failed jobs from this
  session): status, resolution, frame count, capture mode + measured
  capture fps, output folder, and a "copy command" button that reproduces
  any past render.

## Transport & inspector

- Play/Pause, seek bar, time + bar/beat readout.
- **audio**: `off` / `simple synth` — a Web Audio triangle synth
  scheduled on the same timeline clock (sync-checking tool, not final
  audio; see [AUDIO_SETUP.md](AUDIO_SETUP.md)).
- **Timeline inspector** (expand below the transport): live musical state
  from the timing engine at the playhead — time, bar/beat, tempo,
  active/held/sustain-only note counts, notes starting within ±0.5 s,
  active tracks, audio-vs-visual clock drift, and active annotation
  labels when loaded. Use it to answer "what is the music doing right
  now?" while designing mappings.

## CLI equivalents

Every studio action has a command-line twin:

| Studio action | CLI |
|---|---|
| upload MIDI | `midicore\.venv\Scripts\python -m midicore parse song.mid` |
| render video | `npm run render -- --timeline … --visualizer … --params '…'` (or "Copy cmd") |
| capture still | `npm run render -- … --fps 1 --tail 0 --keep-frames` then take the PNG you want |
| audio check | `npm run check:audio` |
| inspect state at t | `midicore\.venv\Scripts\python -m midicore info tl.json --at 12.5` |
| presets | plain JSON files in `presets/` — edit/copy them directly |
