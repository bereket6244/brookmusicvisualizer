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
    soundfontPath: null,
    serverPort: 8787,
    render: {
      fps: 30,
      width: 1920,
      height: 1080,
      tailSeconds: 1.5,
      outputDir: "output/renders",
      keepFrames: false,
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
