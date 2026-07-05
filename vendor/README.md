# vendor/ — project-local audio dependencies

This folder holds the two things audio rendering needs, installed by
**`npm run setup:audio`** (everything except this README is gitignored):

```
vendor/fluidsynth/windows/   FluidSynth Windows x64 build (fluidsynth.exe + DLLs)
vendor/soundfonts/           a .sf2 SoundFont (GeneralUser GS by default) + its license
vendor/CHECKSUMS.txt         sha256 of every file the bootstrapper downloaded
```

With these in place, `--audio` renders and the studio's "Render with
audio" checkbox work without any system-wide installation. Resolution
order and manual-install instructions: [docs/AUDIO_SETUP.md](../docs/AUDIO_SETUP.md).

## Licensing

- **FluidSynth** is LGPL-2.1. It is used here as an unmodified,
  separately-downloaded standalone executable (not linked into this
  project), which the LGPL permits without further obligations.
- **GeneralUser GS** (S. Christian Collins) is distributed under the
  GeneralUser GS license, which permits free use in any project and
  redistribution; its license file is downloaded next to the .sf2 and
  must stay with it if you copy the font elsewhere.
- If you substitute your own SoundFont, verify its license yourself —
  many freeware fonts allow *use* but not *redistribution*.
