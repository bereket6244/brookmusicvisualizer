# Limitations & failure log

Honest list of what is approximate, untested, or intentionally out of
scope — updated after the third pass (studio audio rendering,
2026-07-05). Everything under "Verified" was exercised on the
development machine.

## Verified working (Windows 11, Python 3.14, Node 24)

### Third pass (audio)

- **`npm run setup:audio` ran fully automatically**: FluidSynth v2.5.6
  win10-x64 (2.7 MB) + GeneralUser GS v2.0.3 (32.3 MB) + its license
  downloaded into `vendor/`, sha256s recorded, config written, chain
  validated.
- **`npm run check:audio` — all 4 checks pass**, including a real
  test-MIDI→WAV render through the fixed FluidSynth argument order
  (`-ni -F out.wav -r 44100 font.sf2 song.mid`; order pinned by
  `renderer/lib/audio.test.js`).
- **CLI `--audio` render verified**: `name_audio.mp4` produced; ffmpeg
  stream inspection confirmed H.264 video + AAC 44.1 kHz stereo audio.
- **Studio audio E2E — 14/14 checks**: upload `.mid` → status flips to
  "Audio: Ready" → silent render → render with audio (UI reports
  `♪ audio MP4`) → with-audio file exists on disk →
  `render-info.json` records requested/ok/midi/soundfont/output →
  timeline-JSON-only upload correctly disables audio with an explanation
  → attaching the matching `.mid` re-enables it. No page errors.
- **Silent fallback verified**: with the SoundFont removed, an `--audio`
  render still exits 0, keeps the silent MP4, logs
  `AUDIO SKIPPED: … run npm run setup:audio`, and the structured failure
  reaches the job record (shown as a ⚠ warning in the studio).
- **Vendor auto-discovery verified**: with config paths set to null, the
  chain still resolves both dependencies from `vendor/`.

### Earlier passes

- **33 pytest tests** (parser incl. re-strike/SMPTE/mid-bar-timesig +
  Python timing engine + samples) — pass.
- **23 vitest tests** (TS timing engine, frame math, param
  randomize/mutate determinism, annotation queries) — pass.
- `tsc --noEmit` and `vite build studio` — clean.
- **Studio E2E** (scripted headless-Chromium run): registry lists all 3
  visualizers; adaptive param panel renders groups/sliders/advanced
  toggle per visualizer schema; sample + annotation sidecar auto-load;
  Randomize is reproducible for a fixed seed; preset save→file→contents
  verified; "Copy cmd" yields a valid CLI command; uploaded timeline JSON
  renders through the backend; render history endpoint lists the job;
  still capture downloads a PNG; inspector shows live musical state; no
  page errors — 20/20 checks passed.
- **End-to-end silent renders** (Playwright + ffmpeg-static): full
  918-frame Bach prelude at 1080p/30 with BOTH visualizers and BOTH
  capture modes produced valid MP4s; frames verified visually.
- **Capture modes are pixel-identical**: the same frame extracted from a
  `--capture canvas` render and a `--capture screenshot` render hashed
  identically (md5). Mode changes speed, never content.
- **Measured capture throughput** (this machine, prelude, 918 frames):
  1080p — canvas **20–22 fps** vs screenshot **8.9 fps** (~2.3×);
  640×360 — canvas ~185 fps vs screenshot ~19 fps (~10×). `auto`
  resolved to canvas for all bundled visualizers.
- `npm run check:audio` fails cleanly with actionable messages when
  FluidSynth/SoundFont are absent (exit 1), and passes the FFmpeg check.

## Not verified / known gaps

- **Audio is now verified end-to-end (third pass)** — see above. Remaining
  audio caveats: `vendor/` binaries are per-machine downloads (a zipped
  copy of the repo does not carry them; run `npm run setup:audio` after
  unzip/clone), the bootstrapper depends on GitHub release/raw URLs
  staying alive (manual fallback instructions are printed if they rot),
  and the checksum record in `vendor/CHECKSUMS.txt` documents what was
  downloaded rather than verifying against pinned upstream hashes (the
  upstream projects do not publish stable ones).
- **Audio+video sync is by construction, not by measurement** — frames
  and WAV both derive from the same tempo map, and spot-listening
  confirmed alignment, but no automated cross-correlation test compares
  the two streams.
- **Studio audio preview remains a simple triangle-wave synth** (now with
  an off/synth mode selector and an audio-vs-visual drift readout in the
  inspector). A SoundFont-backed browser preview was evaluated and
  deliberately skipped: WASM synth builds are multi-MB, need the
  SoundFont served to the browser, and contribute nothing to render
  correctness. Long previews may drift a few ms (wall clock vs
  AudioContext clock) — visible in the inspector, irrelevant to renders.
- **Sustain modeling is better but still simplified.** Re-striking a
  pitch now cuts the previous note's pedal tail (flagged `restruck`), and
  raw CC64 values (half-pedal levels) are preserved in `sustain_events`.
  Still simplified: half-pedaling is binarized at the standard ≥64
  threshold for duration purposes (a value of 40 counts as "up" even
  though a real piano would partially damp); sostenuto (CC66) and soft
  pedal (CC67) are ignored; sympathetic resonance is not modeled.
- **Bar/beat with mid-bar time-signature changes**: a change landing
  mid-bar starts a new bar at the change point (standard notation
  practice; now pinned by a test). Exotic files may disagree with other
  tools' bar numbers. Note timing and render sync are unaffected — only
  the bar/beat labels.
- **SMPTE-timebase MIDI files are rejected, not supported.** The parser
  detects the SMPTE division bit and raises `SMPTETimebaseError` with
  advice to re-export with PPQ timing (previously they were untested and
  would have parsed with wrong timing). Actual SMPTE support was judged
  not worth it — such files are vanishingly rare for classical piano.
- **Canvas capture assumptions**: `--capture canvas` requires the
  visualizer to draw exactly one full-frame canvas and (for WebGL)
  `preserveDrawingBuffer: true`. All bundled visualizers comply; `auto`
  falls back to screenshots for any that don't. A WebCodecs/CDP-stream
  path could be faster still at 1080p (PNG encoding in the page is now
  the bottleneck) — noted as the next optimization if needed.
- **Preset "Load" does not reload the timeline** it was authored against
  (it applies visualizer/params/render settings and reports the original
  timeline path in the status line). Chosen to keep loading side-effect
  free; load the timeline first if you want an exact reproduction.
- **Render history** lists completed renders from `render-info.json`
  files (survives restarts) but failed jobs only from the current server
  session (failures write no info file by design).
- **Playwright + ffmpeg binaries are per-machine downloads** (`npm
  install` + `npx playwright install chromium`). The zipped project will
  not carry them; the two install commands in the README are required
  after unzip.
- The generated **"Bach prelude" is a simplified 8-bar rendition** of
  BWV 846 (public domain) for demo purposes, not a faithful edition.
- The **E2E studio test is a scratch script**, not part of `npm test`
  (it boots servers and a browser; keeping CI-style tests hermetic was
  preferred). The unit/build gates above are the maintained suites.
