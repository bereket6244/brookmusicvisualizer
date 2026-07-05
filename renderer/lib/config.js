/**
 * Project paths + config/project.config.json loading.
 * Everything is resolved relative to the repo root so the project can
 * live in any directory (no hardcoded absolute paths).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), "..", "..",
);

const CONFIG_PATH = path.join(ROOT, "config", "project.config.json");

export function loadConfig() {
  const defaults = {
    pythonCommand: null,
    // Audio deps: null = use the fallback chain (env vars -> vendor/ ->
    // system PATH); see renderer/lib/audio.js. `npm run setup:audio`
    // fills these in with project-local vendor paths.
    soundfontPath: null,
    fluidsynthPath: null,
    serverPort: 8787,
    render: {
      fps: 30,
      width: 1920,
      height: 1080,
      tailSeconds: 1.5,
      outputDir: "output/renders",
      keepFrames: false,
      // "auto" probes the fast canvas capture and falls back to Playwright
      // screenshots; see renderer/render.js and docs/GUIDE.md.
      capture: "auto",
    },
  };
  try {
    const user = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
    return {
      ...defaults,
      ...user,
      render: { ...defaults.render, ...(user.render ?? {}) },
    };
  } catch {
    return defaults;
  }
}

/** Resolve a possibly-relative path against the repo root. */
export function fromRoot(p) {
  return path.isAbsolute(p) ? p : path.join(ROOT, p);
}
