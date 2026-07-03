/**
 * Locate a Python interpreter that has midicore installed and run the
 * parser through it. Search order:
 *   1. MIDICORE_PYTHON env var
 *   2. config/project.config.json "pythonCommand"
 *   3. the project venv (midicore/.venv/Scripts/python.exe)
 *   4. "py" / "python" on PATH
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { loadConfig, ROOT } from "./config.js";

let cached = null;

export function findPython() {
  if (cached) return cached;
  const config = loadConfig();
  const candidates = [
    process.env.MIDICORE_PYTHON,
    config.pythonCommand,
    path.join(ROOT, "midicore", ".venv", "Scripts", "python.exe"),
    "py",
    "python",
  ].filter(Boolean);

  for (const cmd of candidates) {
    if (cmd.includes(path.sep) && !fs.existsSync(cmd)) continue;
    const probe = spawnSync(cmd, ["-c", "import midicore"], {
      timeout: 15000,
    });
    if (probe.status === 0) {
      cached = cmd;
      return cmd;
    }
  }
  throw new Error(
    "No Python with midicore installed was found. Create the venv first:\n"
    + "  cd midicore && python -m venv .venv && "
    + ".venv\\Scripts\\pip install -e .",
  );
}

/** Run `python -m midicore parse` and return the timeline object. */
export function parseMidi(midiPath, outPath) {
  const python = findPython();
  const result = spawnSync(
    python, ["-m", "midicore", "parse", midiPath, "-o", outPath],
    { cwd: ROOT, encoding: "utf-8", timeout: 120000 },
  );
  if (result.status !== 0) {
    throw new Error(`midicore parse failed: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(fs.readFileSync(outPath, "utf-8"));
}
