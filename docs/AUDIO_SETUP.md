# Audio Setup Guide (optional)

Silent video rendering **never** needs anything on this page. Audio is a
strictly optional add-on; every failure in this chain is logged and the
silent MP4 remains the valid output.

## Why MIDI needs all this

**MIDI is not audio.** A `.mid` file is a list of instructions — "press
C4 at t=0 with velocity 80" — not sound. Turning instructions into sound
requires:

1. a **synthesizer** — software that executes the instructions. We use
   [FluidSynth](https://www.fluidsynth.org/) (free, open source).
2. **instrument sounds** — a **SoundFont** (`.sf2`): a bank of sampled
   instruments (real piano recordings for every pitch range, etc.).
   FluidSynth without a SoundFont is an orchestra with no instruments.

## Setup on Windows

### 1. Install FluidSynth

```powershell
winget install FluidSynth.FluidSynth
```

(or download a release zip from fluidsynth.org and extract it somewhere).
Then **reopen the terminal** and verify it's reachable:

```powershell
fluidsynth --version
```

If that fails after a winget/zip install, the `bin` folder isn't on PATH:
Settings → System → About → Advanced system settings → Environment
Variables → edit `Path` → add e.g. `C:\tools\fluidsynth\bin`.

### 2. Get a free SoundFont

Recommended: **GeneralUser GS** (~30 MB, free, good piano) from
https://schristiancollins.com/generaluser.php — or `FluidR3_GM.sf2`
(larger, widely mirrored). Save it anywhere, e.g.
`C:\soundfonts\GeneralUser-GS.sf2`.

### 3. Tell the project where it is

Either edit `config/project.config.json`:

```json
{ "soundfontPath": "C:\\soundfonts\\GeneralUser-GS.sf2" }
```

or set the `SOUNDFONT` environment variable (takes precedence):

```powershell
$env:SOUNDFONT = "C:\soundfonts\GeneralUser-GS.sf2"
```

### 4. Verify the whole chain

```powershell
npm run check:audio
```

This checks each link — FluidSynth on PATH, SoundFont configured, file
exists, a real test render of `samples/single_note.mid` to WAV, and FFmpeg
for muxing — and prints exactly what to fix if something fails. Exit code
0 means `--audio` renders will work.

## How `--audio` works

```powershell
npm run render -- --timeline samples/prelude_c.timeline.json --audio
```

1. The silent MP4 is rendered first, exactly as always.
2. FluidSynth renders the source MIDI offline to WAV:
   `fluidsynth -ni <soundfont.sf2> <file.mid> -F <out.wav> -r 44100`
   (`-n` no MIDI input, `-i` no interactive shell). The MIDI is found next
   to the timeline (`foo.timeline.json` → `foo.mid`) or via `--midi`.
3. FFmpeg muxes the WAV into the already-rendered video:
   `ffmpeg -i silent.mp4 -i audio.wav -c:v copy -c:a aac -b:a 192k -shortest out_audio.mp4`
   — the video stream is copied bit-for-bit; `-shortest` trims the tail
   difference.

Sync note: both the video frames and the WAV are generated offline from
the same tempo map, so they line up by construction — there is no
"recording" step to drift.

## Studio preview audio is a different thing

The studio's preview synth (off / "simple synth" in the transport bar) is
a tiny built-in Web Audio triangle-wave synth for checking *sync*, not
sound quality. It never touches renders. A SoundFont-based browser preview
was considered and skipped deliberately: the WASM synth builds are
multi-megabyte, need the SoundFont shipped to the browser, and add nothing
to render correctness. The inspector panel shows audio-vs-visual clock
drift if you want to verify sync numerically.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `AUDIO SKIPPED: no SoundFont configured` | step 3 above |
| `AUDIO SKIPPED: fluidsynth is not installed / not on PATH` | steps 1 + PATH note |
| WAV renders but sounds wrong/thin | try a different SoundFont; GM program coverage varies |
| `MIDI file not found` | pass `--midi path\to\file.mid` (timeline JSONs don't embed the MIDI) |
| check:audio passes but render skips audio | make sure the env var is set in the *same terminal* as the render |
