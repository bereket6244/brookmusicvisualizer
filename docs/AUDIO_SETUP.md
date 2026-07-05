# Audio Setup Guide

Silent video rendering **never** needs anything on this page. Audio is a
strictly optional add-on; every failure in this chain is logged (CLI and
studio UI) and the silent MP4 remains the valid output.

## TL;DR — one command

```powershell
npm run setup:audio
npm run check:audio     # verify: all four checks should say OK
```

That installs everything audio needs **into the project folder**
(`vendor/`) — no system-wide install, no PATH editing, no admin rights,
and nothing to reconfigure when you copy the project to another machine
(just re-run the command there). Then either:

- **Studio**: tick **"Render with audio"** in the Render panel (the
  status line above the checkbox tells you if anything is missing), or
- **CLI**: add `--audio` to a render:

```powershell
npm run render -- --timeline samples/prelude_c.timeline.json --audio
```

## Why MIDI needs all this

**MIDI is not audio.** A `.mid` file is a list of instructions — "press
C4 at t=0 with velocity 80" — not sound. Turning instructions into sound
requires:

1. a **synthesizer** — software that executes the instructions. We use
   [FluidSynth](https://www.fluidsynth.org/) (free, open source).
2. **instrument sounds** — a **SoundFont** (`.sf2`): a bank of sampled
   instruments. FluidSynth without a SoundFont is an orchestra with no
   instruments. The bootstrapper installs **GeneralUser GS** (~32 MB).

This is also why **a timeline JSON alone cannot produce audio**: the
timeline describes the visuals; synthesis needs the original `.mid`. The
studio tracks the source MIDI automatically when you upload a `.mid`; if
you loaded only a `.timeline.json`, the Render panel offers an
"Attach the source MIDI" input.

## What `setup:audio` does

1. Downloads the latest official FluidSynth Windows x64 build from the
   project's GitHub releases into `vendor/fluidsynth/windows/`.
2. Downloads the GeneralUser GS SoundFont (plus its license file) into
   `vendor/soundfonts/`.
3. Records sha256 checksums of everything in `vendor/CHECKSUMS.txt` and
   sanity-checks the SoundFont header.
4. Writes the resolved paths into `config/project.config.json`.
5. Validates the result (same logic as `npm run check:audio`).

It is idempotent — re-running skips whatever is already installed. If a
download fails (offline, proxy), it prints exact manual instructions:
drop the files into the folders above and re-run to validate.

## How the project finds the audio tools

Both FluidSynth and the SoundFont are resolved through the same fallback
chain (first hit wins) — implemented in `renderer/lib/audio.js`:

```
1. explicit path in config/project.config.json  (fluidsynthPath / soundfontPath)
2. environment variables                        (FLUIDSYNTH_PATH / SOUNDFONT)
3. project-local vendor/ folders                (what setup:audio installs)
4. `fluidsynth` on the system PATH              (FluidSynth only)
5. clear failure message pointing at setup:audio
```

So a system-wide FluidSynth still works, an env var can override
everything for one shell session, and a plain `git clone` +
`npm run setup:audio` is fully self-contained.

## The FluidSynth command (and the argument-order bug)

The renderer invokes FluidSynth in exactly this shape — confirmed working
on Windows:

```powershell
fluidsynth -ni -F output.wav -r 44100 path\to\soundfont.sf2 path\to\song.mid
```

**The output options (`-F`, `-r`) must come BEFORE the positional
soundfont/MIDI arguments.** An earlier version passed
`-ni soundfont.sf2 song.mid -F output.wav -r 44100`; on Windows builds
this made FluidSynth ignore the fast-render request and never write the
WAV. The order is pinned by a regression test
(`renderer/lib/audio.test.js`) and verified live by `npm run check:audio`
(which renders a real test MIDI to WAV through the same code path).

## The full `--audio` pipeline

1. The silent MP4 is rendered first, exactly as always.
2. FluidSynth renders the source MIDI offline to WAV (command above).
   The MIDI comes from `--midi`, the studio's tracked source MIDI, or the
   convention `foo.timeline.json` → `foo.mid` next to it.
3. FFmpeg muxes the WAV into the already-rendered video:
   `ffmpeg -i silent.mp4 -i audio.wav -c:v copy -c:a aac -b:a 192k -shortest name_audio.mp4`
   — the video stream is copied bit-for-bit; `-shortest` trims the tail
   difference. Both files stay in the job folder (`name.mp4` silent,
   `name_audio.mp4` with sound).
4. `render-info.json` records the whole attempt: requested?, succeeded?,
   which MIDI, which SoundFont, which output file — and the studio shows
   ♪ success or a ⚠ warning with the reason.

Sync note: both the video frames and the WAV are generated offline from
the same tempo map, so they line up by construction — there is no
"recording" step to drift.

## Studio preview audio is a different thing

The studio's preview synth (off / "simple synth" in the transport bar) is
a tiny built-in Web Audio triangle-wave synth for checking *sync*, not
sound quality. It never touches renders. Final-render audio is always the
FluidSynth + SoundFont path on this page.

## Licensing

- **FluidSynth** — LGPL-2.1. Used as an unmodified standalone executable
  downloaded from the project's own releases (not linked into this
  codebase), which the LGPL permits. Source: github.com/FluidSynth/fluidsynth.
- **GeneralUser GS** (S. Christian Collins) — its license (v2.0,
  downloaded alongside the font) allows unrestricted use in your own
  music/software projects, private or commercial, and redistribution of
  the bank. The license file must stay with the font if you copy it.
- Neither binary is committed to the repo (`vendor/` is gitignored);
  every machine fetches its own copy from the upstream sources.
- **If you swap in a different SoundFont**: check its license yourself —
  many freeware .sf2 files allow *use* but not *redistribution*.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Studio says "Missing FluidSynth" / "Missing SoundFont" | `npm run setup:audio`, then reload the studio page |
| `AUDIO SKIPPED: SoundFont unavailable` on CLI | same — or set `SOUNDFONT` to a valid .sf2 |
| Studio says "no source MIDI" | you loaded a timeline JSON only — attach the matching `.mid` in the Render panel, or upload the `.mid` instead |
| fluidsynth runs but no WAV appears | you are likely invoking it manually with `-F` *after* the file arguments — use the exact order shown above |
| WAV renders but sounds wrong/thin | try a different SoundFont; GM program coverage varies |
| `setup:audio` download fails | follow the printed manual instructions (files into `vendor/…`), re-run to validate |
| check:audio passes but studio still shows missing | the backend caches nothing, but the page does not poll — reload the studio tab |
