/**
 * The visualizer contract. Every visualizer — 2D canvas, Three.js/WebGL,
 * shaders, particles — implements this interface and is driven purely by
 * explicit timestamps through the shared TimingEngine.
 *
 * Parameter schema (v2): specs may declare a `group` (collapsible section
 * in the studio), tooltips, advanced/randomizable flags, and richer types
 * (vec2/vec3/range/seed). Everything is backwards compatible with the v1
 * schema — old specs with just {key,label,type,default} still work.
 * Full field reference: docs/GUIDE.md "Visualizer parameters".
 */

import type { AnnotationSet } from "../core/annotations";
import type { TimingEngine } from "../core/timing-engine";

export type VisualizerStatus = "dev" | "final";

export type ParamType =
  | "number"   // scalar; rendered as slider + numeric input when min/max exist
  | "color"    // "#rrggbb" string
  | "boolean"
  | "select"   // one of `options`
  | "vec2"     // [x, y]
  | "vec3"     // [x, y, z]
  | "range"    // [min, max] pair, kept ordered by the UI
  | "seed";    // non-negative integer driving deterministic randomness

/** vec2/vec3/range values are plain number arrays so params stay JSON-safe. */
export type ParamValue = number | string | boolean | number[];

export interface ParamSpec {
  key: string;
  label: string;
  type: ParamType;
  default: ParamValue;
  /** For "number", "seed", and the components of vec/range types. */
  min?: number;
  max?: number;
  step?: number;
  /** For type "select". */
  options?: string[];
  /** Shown as a tooltip / inline hint in the studio. */
  description?: string;
  /** Collapsible section name (e.g. "Layout", "Motion", "Color").
   * Params without a group land in "General". */
  group?: string;
  /** Hidden unless the studio's "show advanced" toggle is on. */
  advanced?: boolean;
  /** Opt-in: only params marked randomizable are touched by the studio's
   * Randomize/Mutate tools. Booleans/selects are randomized by choice,
   * numbers within [min, max], colors by hue. */
  randomizable?: boolean;
}

export type ParamValues = Record<string, ParamValue>;

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
  /** Optional musical annotations (motifs, voices, sections) loaded from a
   * sidecar JSON — see docs/ANNOTATIONS.md. Undefined when none loaded. */
  annotations?: AnnotationSet;
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
  for (const p of def.params) {
    // Copy arrays so a visualizer mutating its params can't corrupt the spec.
    out[p.key] = Array.isArray(p.default) ? [...p.default] : p.default;
  }
  return out;
}
