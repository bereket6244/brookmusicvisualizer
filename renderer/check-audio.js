/**
 * Audio pipeline diagnostic: `npm run check:audio`
 *
 * Verifies each link of the OPTIONAL audio chain and says exactly what is
 * missing and how to fix it. Silent video rendering never depends on any
 * of this — see docs/AUDIO_SETUP.md for the full setup guide.
 *
 * Checks:
 *   1. fluidsynth on PATH (the synthesizer that turns MIDI into audio)
 *   2. a SoundFont is configured (SOUNDFONT env var or soundfontPath in
 *      config/project.config.json)
 *   3. the SoundFont file exists
 *   4. a real end-to-end test: render samples/single_note.mid -> WAV
 *   5. ffmpeg availability (for muxing the WAV into the MP4)
 *
 * Exit code 0 = audio rendering will work; 1 = at least one link missing.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { renderAudio } from "./lib/audio.js";
import { loadConfig, ROOT } from "./lib/config.js";
import { resolveFfmpeg } from "./lib/ffmpeg.js";

const config = loadConfig();
let failures = 0;

function check(label, ok, detail) {
  const mark = ok ? "OK  " : "FAIL";
  console.log(`[${mark}] ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
  return ok;
}

console.log("Audio pipeline diagnostic (silent rendering does NOT need any of this)\n");

// 1. fluidsynth ---------------------------------------------------------------
const fsResult = spawnSync("fluidsynth", ["--version"], { encoding: "utf-8" });
const fluidsynthOk = check(
  "FluidSynth installed",
  !fsResult.error && fsResult.status === 0,
  fsResult.error
    ? "not found on PATH. Install: `winget install FluidSynth.FluidSynth` "
      + "(or download from fluidsynth.org), then reopen the terminal"
    : (fsResult.stdout || "").split("\n")[0].trim(),
);

// 2. SoundFont configured -----------------------------------------------------
const soundfont = process.env.SOUNDFONT || config.soundfontPath;
const configuredOk = check(
  "SoundFont configured",
  Boolean(soundfont),
  soundfont
    ? soundfont
    : "set soundfontPath in config/project.config.json or the SOUNDFONT env "
      + "var. Free option: GeneralUser GS (~30 MB) — see docs/AUDIO_SETUP.md",
);

// 3. SoundFont exists ---------------------------------------------------------
const existsOk = configuredOk && check(
  "SoundFont file exists",
  fs.existsSync(soundfont),
  fs.existsSync(soundfont ?? "")
    ? `${(fs.statSync(soundfont).size / 1e6).toFixed(1)} MB`
    : `not found at ${soundfont}`,
);

// 4. End-to-end tiny render ---------------------------------------------------
if (fluidsynthOk && existsOk) {
  const testMidi = path.join(ROOT, "samples", "single_note.mid");
  if (!fs.existsSync(testMidi)) {
    check("Test MIDI available", false,
      "samples/single_note.mid missing — run: "
      + "midicore\\.venv\\Scripts\\python -m midicore samples");
  } else {
    const wavPath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "viz-audiocheck-")), "test.wav");
    const result = renderAudio(testMidi, wavPath);
    const wavOk = result.ok && fs.existsSync(wavPath) && fs.statSync(wavPath).size > 1000;
    check("Test MIDI renders to WAV", wavOk,
      wavOk
        ? `${(fs.statSync(wavPath).size / 1024).toFixed(0)} KB WAV produced`
        : result.reason ?? "WAV missing or empty");
    fs.rmSync(path.dirname(wavPath), { recursive: true, force: true });
  }
} else {
  check("Test MIDI renders to WAV", false, "skipped (prerequisites missing)");
}

// 5. ffmpeg (mux step) --------------------------------------------------------
const ffmpeg = resolveFfmpeg();
const ffResult = spawnSync(ffmpeg, ["-version"], { encoding: "utf-8" });
check(
  "FFmpeg available (for muxing)",
  !ffResult.error && ffResult.status === 0,
  ffResult.error ? "run `npm install` (ffmpeg-static) or install ffmpeg"
    : (ffResult.stdout || "").split("\n")[0].trim(),
);

console.log(failures
  ? `\n${failures} check(s) failed — audio rendering will be SKIPPED, silent `
    + "MP4s still work. Setup guide: docs/AUDIO_SETUP.md"
  : "\nAll checks passed — render with --audio to get an MP4 with sound.");
process.exit(failures ? 1 : 0);
