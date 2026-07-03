# Limitations & failure log

Honest list of what is approximate, untested, or intentionally out of
scope. Everything below the "Verified" section was exercised on the
development machine before handoff.

## Verified working (Windows 11, Python 3.14, Node 24)

- 28 pytest tests (parser + Python timing engine + samples) — pass.
- 8 vitest tests (TS timing engine + frame math) — pass.
- `tsc --noEmit` and `vite build studio` — clean.
- End-to-end silent render (Playwright + ffmpeg-static): both a small
  smoke render and the full 918-frame Bach prelude demo at 1280×720/30fps
  produced valid MP4s; frames verified visually.

## Not verified / known gaps

- **Audio rendering was not executed** — FluidSynth and a SoundFont are
  not installed on the dev machine. The code path
  (`renderer/lib/audio.js`) follows the documented FluidSynth CLI and
  fails soft by design (logs `AUDIO SKIPPED`, keeps the silent MP4), but
  it has not run against a real FluidSynth install.
- **Studio audio preview is an approximation.** A triangle-wave Web Audio
  synth, scheduled against the timeline clock. Good for checking sync,
  nothing like a piano. Long previews may drift a few ms from the visual
  clock (wall clock vs AudioContext clock); irrelevant for renders, which
  never use it.
- **Render throughput is ~10–15 fps of capture** (Playwright screenshot
  per frame). A 10-minute piece at 30 fps is ~25–45 minutes of capture.
  This is the price of the fully deterministic screenshot pipeline; a
  faster `canvas.toDataURL`/WebCodecs path would be the first optimization
  to try.
- **Sustain nuances simplified:** re-striking a pitch while it is
  pedal-sustained does not cut the earlier note's tail (real pianos are
  messier); half-pedaling (values between 1–63/64–127 transitions) is
  binarized at the standard ≥64 threshold; sostenuto (CC66) and soft
  pedal (CC67) are ignored.
- **Bar/beat with mid-bar time-signature changes:** a signature change
  that lands mid-bar starts a new bar at the change point (standard
  notation practice, but exotic files may disagree with other tools).
- **SMPTE-timebase MIDI files** (negative division, frames-per-second
  timing) are untested; PPQ files are the overwhelming norm.
- **Uploaded-timeline renders require the backend** — a timeline JSON
  loaded from the local file picker can be previewed but not rendered
  (the render job needs a server-side path). Upload the `.mid` instead,
  or drop the JSON into `samples/`.
- **Playwright + ffmpeg binaries are per-machine downloads** (`npm
  install` + `npx playwright install chromium`). The zipped project will
  not carry them; the two install commands in the README are required
  after unzip.
- The generated **"Bach prelude" is a simplified 8-bar rendition** of
  BWV 846 (public domain) for demo purposes, not a faithful edition.
