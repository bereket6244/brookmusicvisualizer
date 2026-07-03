/**
 * The visualizer contract. Every visualizer — 2D canvas, Three.js/WebGL,
 * shaders, particles — implements this interface and is driven purely by
 * explicit timestamps through the shared TimingEngine.
 */

import type { TimingEngine } from "../core/timing-engine";

export type VisualizerStatus = "dev" | "final";

export interface ParamSpec {
  key: string;
  label: string;
  type: "number" | "color" | "boolean" | "select";
  default: number | string | boolean;
  /** For type "number". */
  min?: number;
  max?: number;
  step?: number;
  /** For type "select". */
  options?: string[];
  description?: string;
}

export type ParamValues = Record<string, number | string | boolean>;

export interface VisualizerContext {
  /** Empty container element; the visualizer appends its own canvas so it
   * is free to pick a 2D context, WebGL, or anything else. */
  container: HTMLElement;
  /** Output pixel size. Visualizers should treat 1920x1080 as the design
   * reference and scale internally so previews at 1280x720 look identical. */
  width: number;
  height: number;
  engine: TimingEngine;
  params: ParamValues;
}

export interface VisualizerInstance {
  /**
   * Draw the complete visual state for time t (seconds).
   * MUST be a pure function of t: calling with any t in any order
   * (seeking backward included) must produce the same image. This is what
   * makes offline rendering (t = frame / fps) deterministic.
   */
  renderAtTime(t: number): void;
  /** Re-apply parameters without a full rebuild (optional). */
  setParams?(params: ParamValues): void;
  resize?(width: number, height: number): void;
  dispose(): void;
}

export interface VisualizerDefinition {
  id: string;
  name: string;
  description: string;
  /** Derived from folder (dev/ or final/) by the registry; a value set
   * here is overridden. Promotion = moving the folder. */
  status?: VisualizerStatus;
  /** Rendering technology hint, for the studio UI. */
  renderMode: "2d" | "3d" | "both";
  params: ParamSpec[];
  create(ctx: VisualizerContext): VisualizerInstance;
}

export function defaultParams(def: VisualizerDefinition): ParamValues {
  const out: ParamValues = {};
  for (const p of def.params) out[p.key] = p.default;
  return out;
}
