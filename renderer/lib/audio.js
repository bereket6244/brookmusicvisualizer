/**
 * Optional MIDI -> WAV rendering via FluidSynth, with self-contained
 * dependency resolution.
 *
 * MIDI files contain instructions, not sound; producing audio requires a
 * synthesizer plus instrument samples (a SoundFont). This project uses
 * the free/open-source pair FluidSynth + a redistributable .sf2
 * (GeneralUser GS by default). `npm run setup:audio` installs both into
 * vendor/ so no system-wide setup is needed; see docs/AUDIO_SETUP.md.
 *
 * Resolution order (first hit wins), same for both dependencies:
 *   1. explicit path in config/project.config.json
 *      (fluidsynthPath / soundfontPath, project-relative allowed)
 *   2. environment variables FLUIDSYNTH_PATH / SOUNDFONT
 *   3. project-local vendor/ (vendor/fluidsynth/windows/**,
 *      vendor/soundfonts/*.sf2|sf3)
 *   4. `fluidsynth` on the system PATH (FluidSynth only)
 *
 * If either link is missing the render pipeline logs why and keeps the
 * silent video — audio is strictly best-effort.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { fromRoot, loadConfig, ROOT } from "./config.js";

/**
 * The FluidSynth command line, in the shape confirmed to work on Windows:
 *
 *   fluidsynth -ni -F out.wav -r 44100 soundfont.sf2 song.mid
 *
 * ORDER MATTERS: the output options (-F, -r) MUST come before the
 * positional soundfont/MIDI arguments. With the options placed after the
 * positionals, some Windows builds start an interactive/JACK session
 * instead of fast offline rendering and never write the WAV
 * (regression-tested in audio.test.js — do not reorder).
 * -ni = no shell prompt, no MIDI input; plain offline file rendering.
 */
export function buildFluidsynthArgs(wavPath, soundfontPath, midiPath) {
  return ["-ni", "-F", wavPath, "-r", "44100", soundfontPath, midiPath];
}

/** Search vendor/fluidsynth/windows (any depth) for fluidsynth.exe. */
function findVendorFluidsynth() {
  const base = path.join(ROOT, "vendor", "fluidsynth", "windows");
  if (!fs.existsSync(base)) return null;
  const stack = [base];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (/^fluidsynth(\.exe)?$/i.test(entry.name)) return full;
    }
  }
  return null;
}

function findVendorSoundfont() {
  const dir = path.join(ROOT, "vendor", "soundfonts");
  if (!fs.existsSync(dir)) return null;
  const fonts = fs.readdirSync(dir)
    .filter((f) => /\.sf[23]$/i.test(f))
    .sort(); // deterministic pick if several are present
  return fonts.length ? path.join(dir, fonts[0]) : null;
}

/** What (if anything) is already installed under vendor/ — used by the
 * setup:audio bootstrapper to stay idempotent. */
export function findVendorPaths() {
  return { fluidsynth: findVendorFluidsynth(), soundfont: findVendorSoundfont() };
}

/**
 * @returns {{path: string, source: string} | null} where the fluidsynth
 * executable was found and which link of the fallback chain provided it.
 */
export function resolveFluidsynth() {
  const config = loadConfig();
  if (config.fluidsynthPath) {
    return { path: fromRoot(config.fluidsynthPath), source: "config fluidsynthPath" };
  }
  if (process.env.FLUIDSYNTH_PATH) {
    return { path: process.env.FLUIDSYNTH_PATH, source: "FLUIDSYNTH_PATH env var" };
  }
  const vendor = findVendorFluidsynth();
  if (vendor) return { path: vendor, source: "vendor/fluidsynth" };
  // PATH fallback: existence is verified by actually running it later.
  return { path: "fluidsynth", source: "system PATH" };
}

/** @returns {{path: string, source: string} | null} */
export function resolveSoundfont() {
  const config = loadConfig();
  if (config.soundfontPath) {
    return { path: fromRoot(config.soundfontPath), source: "config soundfontPath" };
  }
  if (process.env.SOUNDFONT) {
    return { path: process.env.SOUNDFONT, source: "SOUNDFONT env var" };
  }
  const vendor = findVendorSoundfont();
  if (vendor) return { path: vendor, source: "vendor/soundfonts" };
  return null;
}

/**
 * Structured readiness report for diagnostics (check-audio CLI and the
 * studio's /api/audio-status endpoint).
 */
export function audioStatus() {
  const status = {
    ready: false,
    fluidsynth: { ok: false, path: null, source: null, version: null, reason: null },
    soundfont: { ok: false, path: null, source: null, sizeMb: null, reason: null },
    fix: "run `npm run setup:audio` (downloads FluidSynth + a free SoundFont into vendor/)",
  };

  const synth = resolveFluidsynth();
  status.fluidsynth.path = synth.path;
  status.fluidsynth.source = synth.source;
  // A configured/vendored path that doesn't exist is a clearer error than
  // letting spawn fail with ENOENT.
  if (synth.source !== "system PATH" && !fs.existsSync(synth.path)) {
    status.fluidsynth.reason = `not found at ${synth.path} (${synth.source})`;
  } else {
    const probe = spawnSync(synth.path, ["--version"], { encoding: "utf-8", timeout: 15000 });
    if (probe.error || probe.status !== 0) {
      status.fluidsynth.reason = synth.source === "system PATH"
        ? "fluidsynth not found on PATH"
        : `${synth.path} failed to run: ${probe.error?.message ?? `exit ${probe.status}`}`;
    } else {
      status.fluidsynth.ok = true;
      status.fluidsynth.version = (probe.stdout || probe.stderr || "")
        .split("\n")[0].trim();
    }
  }

  const font = resolveSoundfont();
  if (!font) {
    status.soundfont.reason = "no SoundFont configured or found in vendor/soundfonts";
  } else {
    status.soundfont.path = font.path;
    status.soundfont.source = font.source;
    if (!fs.existsSync(font.path)) {
      status.soundfont.reason = `not found at ${font.path} (${font.source})`;
    } else {
      status.soundfont.ok = true;
      status.soundfont.sizeMb = Number((fs.statSync(font.path).size / 1e6).toFixed(1));
    }
  }

  status.ready = status.fluidsynth.ok && status.soundfont.ok;
  if (status.ready) status.fix = null;
  return status;
}

/**
 * Render a MIDI file to WAV.
 * @returns {{ok: true, soundfont: string, fluidsynth: string}
 *         | {ok: false, reason: string}}
 */
export function renderAudio(midiPath, wavPath) {
  const status = audioStatus();
  if (!status.fluidsynth.ok) {
    return { ok: false, reason: `FluidSynth unavailable: ${status.fluidsynth.reason}. ${status.fix}` };
  }
  if (!status.soundfont.ok) {
    return { ok: false, reason: `SoundFont unavailable: ${status.soundfont.reason}. ${status.fix}` };
  }

  const result = spawnSync(
    status.fluidsynth.path,
    buildFluidsynthArgs(wavPath, status.soundfont.path, midiPath),
    { encoding: "utf-8", timeout: 600000 },
  );
  if (result.error) {
    return { ok: false, reason: `fluidsynth failed to start: ${result.error.message}` };
  }
  if (result.status !== 0 || !fs.existsSync(wavPath) || fs.statSync(wavPath).size < 100) {
    return {
      ok: false,
      reason: `fluidsynth exited with ${result.status}: `
        + (result.stderr || result.stdout || "").split("\n")
          .filter((l) => l.trim()).slice(-5).join(" "),
    };
  }
  return { ok: true, soundfont: status.soundfont.path, fluidsynth: status.fluidsynth.path };
}
