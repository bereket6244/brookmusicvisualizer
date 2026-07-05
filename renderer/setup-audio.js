/**
 * One-command audio bootstrapper: `npm run setup:audio`
 *
 * Makes audio rendering self-contained by installing both audio
 * dependencies into the project's vendor/ folder (no system PATH setup,
 * no per-machine reinstall):
 *
 *   vendor/fluidsynth/windows/   official FluidSynth Windows x64 build
 *                                (LGPL-2.1; unmodified binaries from the
 *                                project's GitHub releases)
 *   vendor/soundfonts/           GeneralUser GS SoundFont (~30 MB) — a
 *                                high-quality GM bank whose license
 *                                permits free use and redistribution; the
 *                                license file is downloaded alongside it
 *
 * After a successful install the resolved paths are written into
 * config/project.config.json (fluidsynthPath / soundfontPath) so every
 * tool agrees on them. Everything is idempotent: pieces already present
 * are kept; run again after a failure to retry only what is missing.
 *
 * If a download fails (offline, URL rot, proxy), the script prints the
 * exact manual instructions — drop the files into the vendor folders
 * shown above and re-run this script to validate. Licensing notes live
 * in docs/AUDIO_SETUP.md.
 */

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { audioStatus, findVendorPaths } from "./lib/audio.js";
import { ROOT } from "./lib/config.js";

const VENDOR_FS_DIR = path.join(ROOT, "vendor", "fluidsynth", "windows");
const VENDOR_SF_DIR = path.join(ROOT, "vendor", "soundfonts");
const CONFIG_PATH = path.join(ROOT, "config", "project.config.json");

const FLUIDSYNTH_RELEASES_API =
  "https://api.github.com/repos/FluidSynth/fluidsynth/releases/latest";
// GeneralUser GS is maintained in this repo; the .sf2 lives at the top level.
const GENERALUSER_API =
  "https://api.github.com/repos/mrbumpy409/GeneralUser-GS/contents/";

function log(msg) { console.log(`[setup:audio] ${msg}`); }
function warn(msg) { console.log(`[setup:audio] !! ${msg}`); }

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "music-visualizer-setup", Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

async function download(url, destPath, label) {
  log(`downloading ${label}…`);
  log(`  ${url}`);
  const res = await fetch(url, { headers: { "User-Agent": "music-visualizer-setup" } });
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, buf);
  const sha = crypto.createHash("sha256").update(buf).digest("hex");
  log(`  ${(buf.length / 1e6).toFixed(1)} MB, sha256 ${sha.slice(0, 16)}…`);
  return { size: buf.length, sha256: sha };
}

/** Windows 10+ ships bsdtar which extracts zips; Expand-Archive is plan B. */
function extractZip(zipPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  let r = spawnSync("tar", ["-xf", zipPath, "-C", destDir], { encoding: "utf-8" });
  if (r.status !== 0) {
    r = spawnSync("powershell", [
      "-NoProfile", "-Command",
      `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${destDir}' -Force`,
    ], { encoding: "utf-8" });
  }
  if (r.status !== 0) {
    throw new Error(`could not extract ${zipPath}: ${r.stderr || r.stdout}`);
  }
}

// ---------------------------------------------------------------------------
// Step 1: FluidSynth
// ---------------------------------------------------------------------------

async function setupFluidsynth(checksums) {
  const existing = findVendorPaths().fluidsynth;
  if (existing) {
    log(`FluidSynth already vendored: ${path.relative(ROOT, existing)}`);
    return existing;
  }
  const release = await fetchJson(FLUIDSYNTH_RELEASES_API);
  // Official Windows builds are named like fluidsynth-2.4.x-win10-x64.zip.
  const asset = (release.assets ?? []).find((a) => /win10-x64\.zip$/i.test(a.name))
    ?? (release.assets ?? []).find((a) => /win.*x64.*\.zip$/i.test(a.name));
  if (!asset) throw new Error(`no Windows x64 zip in release ${release.tag_name}`);

  const zipPath = path.join(VENDOR_FS_DIR, asset.name);
  const info = await download(asset.browser_download_url, zipPath, `FluidSynth ${release.tag_name}`);
  checksums.push(`${info.sha256}  ${asset.name}`);
  extractZip(zipPath, VENDOR_FS_DIR);
  fs.rmSync(zipPath); // keep only the extracted build

  const exe = findVendorPaths().fluidsynth;
  if (!exe) throw new Error("zip extracted but fluidsynth.exe not found inside");
  log(`FluidSynth installed: ${path.relative(ROOT, exe)}`);
  return exe;
}

// ---------------------------------------------------------------------------
// Step 2: SoundFont (GeneralUser GS)
// ---------------------------------------------------------------------------

async function setupSoundfont(checksums) {
  const existing = findVendorPaths().soundfont;
  if (existing) {
    log(`SoundFont already vendored: ${path.relative(ROOT, existing)}`);
    return existing;
  }
  const listing = await fetchJson(GENERALUSER_API);
  const sf2 = listing.find((f) => /\.sf2$/i.test(f.name));
  if (!sf2) throw new Error("no .sf2 found in the GeneralUser GS repository listing");
  // The license lives in the repo's documentation/ folder.
  let license = listing.find((f) => /^licen[cs]e/i.test(f.name));
  if (!license) {
    try {
      const docs = await fetchJson(GENERALUSER_API + "documentation");
      license = docs.find((f) => /^licen[cs]e/i.test(f.name));
    } catch { /* keep license undefined; warned below */ }
  }

  const sfPath = path.join(VENDOR_SF_DIR, sf2.name.replace(/\s+/g, "-"));
  const info = await download(sf2.download_url, sfPath, `SoundFont ${sf2.name}`);
  checksums.push(`${info.sha256}  ${path.basename(sfPath)}`);

  // Sanity check: every SoundFont is a RIFF container.
  const head = Buffer.alloc(4);
  const fd = fs.openSync(sfPath, "r");
  fs.readSync(fd, head, 0, 4, 0);
  fs.closeSync(fd);
  if (head.toString("ascii") !== "RIFF") {
    fs.rmSync(sfPath);
    throw new Error("downloaded SoundFont is not a RIFF/sf2 file — removed");
  }

  // The license must travel with the SoundFont (its terms require it).
  if (license) {
    await download(license.download_url,
      path.join(VENDOR_SF_DIR, license.name), "SoundFont license");
  } else {
    warn("license file not found in repo listing — see docs/AUDIO_SETUP.md for terms");
  }
  log(`SoundFont installed: ${path.relative(ROOT, sfPath)}`);
  return sfPath;
}

// ---------------------------------------------------------------------------
// Step 3: write config + validate
// ---------------------------------------------------------------------------

function writeConfig(fluidsynthPath, soundfontPath) {
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
  // Store project-relative paths so the repo folder stays movable.
  config.fluidsynthPath = path.relative(ROOT, fluidsynthPath).replaceAll("\\", "/");
  config.soundfontPath = path.relative(ROOT, soundfontPath).replaceAll("\\", "/");
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
  log(`config updated: fluidsynthPath=${config.fluidsynthPath}`);
  log(`config updated: soundfontPath=${config.soundfontPath}`);
}

function printManualInstructions() {
  console.log(`
Manual setup (if downloads keep failing):
  1. FluidSynth: get the win10-x64 zip from
       https://github.com/FluidSynth/fluidsynth/releases
     and extract it so fluidsynth.exe ends up somewhere under
       vendor/fluidsynth/windows/
  2. SoundFont: get GeneralUser GS (free) from
       https://github.com/mrbumpy409/GeneralUser-GS
     (or another .sf2 you have the rights to use) and place it in
       vendor/soundfonts/
  3. Re-run: npm run setup:audio   (it will detect the files, update
     config/project.config.json, and validate the pipeline)
`);
}

async function main() {
  log("making audio rendering self-contained (silent rendering never needs this)");
  fs.mkdirSync(VENDOR_FS_DIR, { recursive: true });
  fs.mkdirSync(VENDOR_SF_DIR, { recursive: true });

  const checksums = [];
  let fluidsynth = null;
  let soundfont = null;
  let failed = false;

  try {
    fluidsynth = await setupFluidsynth(checksums);
  } catch (err) {
    warn(`FluidSynth setup failed: ${err.message}`);
    failed = true;
  }
  try {
    soundfont = await setupSoundfont(checksums);
  } catch (err) {
    warn(`SoundFont setup failed: ${err.message}`);
    failed = true;
  }

  if (checksums.length) {
    const file = path.join(ROOT, "vendor", "CHECKSUMS.txt");
    fs.appendFileSync(file, checksums.map((c) => `${c}\n`).join(""));
    log(`checksums recorded in ${path.relative(ROOT, file)}`);
  }

  if (fluidsynth && soundfont) writeConfig(fluidsynth, soundfont);

  // Final validation through the same status logic everything else uses.
  const status = audioStatus();
  log(`FluidSynth: ${status.fluidsynth.ok
    ? `OK (${status.fluidsynth.version}, from ${status.fluidsynth.source})`
    : `MISSING — ${status.fluidsynth.reason}`}`);
  log(`SoundFont:  ${status.soundfont.ok
    ? `OK (${status.soundfont.sizeMb} MB, from ${status.soundfont.source})`
    : `MISSING — ${status.soundfont.reason}`}`);

  if (status.ready) {
    log("audio rendering is ready — verify end-to-end with: npm run check:audio");
  } else {
    printManualInstructions();
    process.exitCode = 1;
  }
  if (failed && status.ready) {
    log("(a download step failed but existing files cover it — all good)");
  }
}

main().catch((err) => {
  warn(`unexpected failure: ${err.message}`);
  printManualInstructions();
  process.exit(1);
});
