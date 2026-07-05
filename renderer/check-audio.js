/**
 * Audio pipeline diagnostic: `npm run check:audio`
 *
 * Verifies each link of the OPTIONAL audio chain and says exactly what is
 * missing and how to fix it. Silent video rendering never depends on any
 * of this — see docs/AUDIO_SETUP.md for the full setup guide.
 *
 * Checks:
 *   1. FluidSynth resolves + runs (config -> env -> vendor/ -> PATH chain)
 *   2. a SoundFont resolves + exists (same chain)
 *   3. a real end-to-end test: render samples/single_note.mid -> WAV using
 *      the exact same code path (and argument order) the renderer uses
 *   4. ffmpeg availability (for muxing the WAV into the MP4)
 *
 * Exit code 0 = audio rendering will work; 1 = at least one link missing.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { audioStatus, renderAudio } from "./lib/audio.js";
import { ROOT } from "./lib/config.js";
import { resolveFfmpeg } from "./lib/ffmpeg.js";

let failures = 0;

function check(label, ok, detail) {
  const mark = ok ? "OK  " : "FAIL";
  console.log(`[${mark}] ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
  return ok;
}

console.log("Audio pipeline diagnostic (silent rendering does NOT need any of this)\n");

const status = audioStatus();

// 1. FluidSynth ---------------------------------------------------------------
check(
  "FluidSynth available",
  status.fluidsynth.ok,
  status.fluidsynth.ok
    ? `${status.fluidsynth.version} (from ${status.fluidsynth.source})`
    : `${status.fluidsynth.reason}. Fix: npm run setup:audio (installs a `
      + "project-local copy into vendor/fluidsynth — no system install needed)",
);

// 2. SoundFont ------------------------------------------------------------------
check(
  "SoundFont available",
  status.soundfont.ok,
  status.soundfont.ok
    ? `${status.soundfont.path} (${status.soundfont.sizeMb} MB, from ${status.soundfont.source})`
    : `${status.soundfont.reason}. Fix: npm run setup:audio (downloads the `
      + "free GeneralUser GS SoundFont into vendor/soundfonts)",
);

// 3. End-to-end tiny render -----------------------------------------------------
if (status.ready) {
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
        ? `${(fs.statSync(wavPath).size / 1024).toFixed(0)} KB WAV produced `
          + "(confirms the fluidsynth argument order works on this machine)"
        : result.reason ?? "WAV missing or empty");
    fs.rmSync(path.dirname(wavPath), { recursive: true, force: true });
  }
} else {
  check("Test MIDI renders to WAV", false,
    "skipped (prerequisites missing — run `npm run setup:audio` first)");
}

// 4. ffmpeg (mux step) ------------------------------------------------------------
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
    + "MP4s still work.\nOne-command fix: npm run setup:audio   "
    + "(guide: docs/AUDIO_SETUP.md)"
  : "\nAll checks passed — enable \"Render with audio\" in the studio, or "
    + "render with --audio on the CLI.");
process.exit(failures ? 1 : 0);
