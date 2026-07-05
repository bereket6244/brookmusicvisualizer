# MIDI Music Visualizer

A modular system that turns MIDI files into deterministic, frame-accurate
music visualization videos.

Pipeline: **MIDI → documented timeline JSON → timing engine → visualizer →
PNG frames (Playwright) → MP4 (ffmpeg)**, with a browser studio for
interactive preview, adaptive per-visualizer controls, presets, and seeded
randomization. Two demo visualizers ship: a cumulative circular portrait
of the whole piece, and a seeded-noise particle field.

Deeper documentation lives in [docs/GUIDE.md](docs/GUIDE.md) (architecture,
schema, writing visualizers, render pipeline) plus
[docs/STUDIO.md](docs/STUDIO.md) (studio controls & presets),
[docs/CREATIVE_WORKFLOW.md](docs/CREATIVE_WORKFLOW.md) (developing
visualizer ideas), [docs/AUDIO_SETUP.md](docs/AUDIO_SETUP.md) and
[docs/ANNOTATIONS.md](docs/ANNOTATIONS.md). Field-by-field timeline format
docs: [docs/SCHEMA.md](docs/SCHEMA.md) and
[docs/GLOSSARY.md](docs/GLOSSARY.md).

## Install (Windows)

Prereqs: Python 3.10+, Node 18+. Everything else is fetched by the commands
below (ffmpeg included via `ffmpeg-static`).

```powershell
# Python side (parser + tests)
cd midicore
python -m venv .venv
.venv\Scripts\pip install -e . pytest
cd ..

# Node side (studio + renderer) — one-time browser download included
npm install
npx playwright install chromium

# Optional but recommended: self-contained audio rendering
# (downloads FluidSynth + a free SoundFont into vendor/, ~35 MB)
npm run setup:audio
```

## Quick run

```powershell
# 1. Generate sample MIDI files + parsed timelines into samples/
midicore\.venv\Scripts\python -m midicore samples --out samples

# 2. Launch the studio (browser UI at http://localhost:5173)
npm run dev

# 3. Render the demo video (silent MP4, written under output/renders/)
npm run render -- --timeline samples/prelude_c.timeline.json --visualizer circular-accumulator
```

## Common commands

| Action | Command |
|---|---|
| Parse a MIDI file | `midicore\.venv\Scripts\python -m midicore parse path\to\file.mid` |
| ...with CSV/JSONL export | add `--csv --jsonl` |
| Inspect a timeline | `midicore\.venv\Scripts\python -m midicore info samples\prelude_c.timeline.json --at 5` |
| Run Python tests | `midicore\.venv\Scripts\python -m pytest midicore` |
| Run TypeScript tests | `npm test` |
| Launch studio | `npm run dev` |
| Render silent video | `npm run render -- --timeline <timeline.json> [--fps 30 --width 1920 --height 1080]` |
| Render with audio (CLI) | add `--audio` (source `.mid` found next to the timeline, or pass `--midi`) |
| Render with audio (Studio) | tick **"Render with audio"** in the Render panel |
| Set up audio dependencies | `npm run setup:audio` (one-time, project-local, no admin) |
| Check the audio setup | `npm run check:audio` |
| Faster frame capture | add `--capture canvas` (default `auto` picks it when possible) |
| Serve the gallery | `npm run gallery` |

## Using your own MIDI

Either upload the `.mid` in the studio (it is parsed automatically), or:

```powershell
midicore\.venv\Scripts\python -m midicore parse mysong.mid -o output\mysong.timeline.json
npm run render -- --timeline output/mysong.timeline.json
```

## Layout

```
midicore/   reusable Python package: MIDI parser, timing engine, CLI, tests
studio/     Vite + TypeScript + Three.js: studio UI, render page, visualizers
renderer/   Node: studio backend, Playwright frame capture, ffmpeg assembly
samples/    generated sample MIDI files + timelines (+ demo annotations)
presets/    saved visualizer presets (small JSON, committable)
docs/       guides (developer, studio, creative workflow, audio, annotations)
gallery/    optional static gallery for finished renders (isolated)
output/     generated files (gitignored)
```
