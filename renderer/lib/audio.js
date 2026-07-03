/**
 * Optional MIDI -> WAV rendering via FluidSynth.
 *
 * MIDI files contain instructions, not sound; producing audio requires a
 * synthesizer plus instrument samples (a SoundFont). This project uses the
 * free/open-source pair FluidSynth + any .sf2 SoundFont (e.g.
 * "GeneralUser GS", free). Neither ships with the repo — see
 * docs/GUIDE.md "Audio rendering" for the two-step setup. If either piece
 * is missing the render pipeline logs why and keeps the silent video.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";

import { loadConfig } from "./config.js";

/**
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function renderAudio(midiPath, wavPath) {
  const config = loadConfig();
  const soundfont = process.env.SOUNDFONT || config.soundfontPath;
  if (!soundfont) {
    return {
      ok: false,
      reason: "no SoundFont configured (set soundfontPath in "
        + "config/project.config.json or the SOUNDFONT env var)",
    };
  }
  if (!fs.existsSync(soundfont)) {
    return { ok: false, reason: `SoundFont not found: ${soundfont}` };
  }

  const result = spawnSync(
    "fluidsynth",
    // -ni: no shell, no MIDI-in; render the file offline to WAV.
    ["-ni", soundfont, midiPath, "-F", wavPath, "-r", "44100"],
    { encoding: "utf-8", timeout: 600000 },
  );
  if (result.error?.code === "ENOENT") {
    return {
      ok: false,
      reason: "fluidsynth is not installed / not on PATH "
        + "(install e.g. via `winget install FluidSynth.FluidSynth`)",
    };
  }
  if (result.status !== 0 || !fs.existsSync(wavPath)) {
    return {
      ok: false,
      reason: `fluidsynth exited with ${result.status}: `
        + (result.stderr || "").split("\n").slice(-5).join(" "),
    };
  }
  return { ok: true };
}
