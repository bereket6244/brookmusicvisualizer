/**
 * Visualizer presets — a saved creative state: visualizer + params +
 * render settings + which timeline it was made against.
 *
 * Presets are plain JSON so they can be exported, diffed, committed, and
 * fed straight back into the CLI (`buildRenderCommand` produces the exact
 * equivalent `node renderer/render.js ...` invocation). The backend stores
 * them under presets/ at the repo root (see renderer/server.js).
 */

import type { ParamValues } from "../visualizers/types";

export interface RenderSettings {
  fps: number;
  width: number;
  height: number;
  name: string;
  capture: "auto" | "screenshot" | "canvas";
}

export interface Preset {
  format: "music-visualizer-preset";
  version: "1.0";
  /** Preset display name (also used for the file name, sanitized). */
  name: string;
  visualizer: string;
  params: ParamValues;
  render: RenderSettings;
  /** Repo-relative timeline path this preset was authored against (or null
   * for a locally loaded timeline the backend never saw). */
  timeline: string | null;
  created_at: string;
  note?: string;
}

export function makePreset(input: {
  name: string;
  visualizer: string;
  params: ParamValues;
  render: RenderSettings;
  timeline: string | null;
  note?: string;
}): Preset {
  return {
    format: "music-visualizer-preset",
    version: "1.0",
    name: input.name,
    visualizer: input.visualizer,
    params: structuredClone(input.params),
    render: { ...input.render },
    timeline: input.timeline,
    created_at: new Date().toISOString(),
    ...(input.note ? { note: input.note } : {}),
  };
}

export function parsePreset(json: unknown): Preset {
  const p = json as Preset;
  if (p?.format !== "music-visualizer-preset") {
    throw new Error('not a preset file (expected format: "music-visualizer-preset")');
  }
  if (typeof p.visualizer !== "string" || typeof p.params !== "object") {
    throw new Error("preset needs a visualizer id and params object");
  }
  return p;
}

/**
 * The CLI command equivalent of "Render video" with the current studio
 * state — CLI parity in one string. JSON params are single-quoted for
 * PowerShell/bash; cmd.exe users may need to swap quote styles.
 */
export function buildRenderCommand(opts: {
  timeline: string | null;
  visualizer: string;
  params: ParamValues;
  render: RenderSettings;
}): string {
  const { timeline, visualizer, params, render } = opts;
  const parts = [
    "node renderer/render.js",
    `--timeline "${timeline ?? "<path/to/timeline.json>"}"`,
    `--visualizer ${visualizer}`,
    `--fps ${render.fps}`,
    `--width ${render.width}`,
    `--height ${render.height}`,
    `--name ${render.name}`,
  ];
  if (render.capture !== "auto") parts.push(`--capture ${render.capture}`);
  if (Object.keys(params).length) {
    parts.push(`--params '${JSON.stringify(params)}'`);
  }
  return parts.join(" ");
}
