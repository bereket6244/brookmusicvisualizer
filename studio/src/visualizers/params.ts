/**
 * Parameter utilities: seeded RNG, deterministic randomize/mutate, and
 * value sanitizing. Used by the studio's creative-exploration tools.
 *
 * Determinism contract: randomizeParams(def, seed) and
 * mutateParams(def, current, seed) return the SAME values for the same
 * inputs, on any machine. A happy accident found with seed 1234 can always
 * be reproduced with seed 1234.
 */

import type { ParamSpec, ParamValue, ParamValues, VisualizerDefinition } from "./types";
import { defaultParams } from "./types";

// ---------------------------------------------------------------------------
// Seeded RNG (mulberry32) — tiny, fast, good-enough distribution for
// parameter exploration. NOT cryptographic.
// ---------------------------------------------------------------------------

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit hash for strings (FNV-1a). Used to derive per-note seeds. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/** Snap to the spec's step grid (relative to min) so randomized values look
 * like values a human could have set with the slider. */
function snap(v: number, spec: ParamSpec): number {
  if (!spec.step) return v;
  const base = spec.min ?? 0;
  const snapped = base + Math.round((v - base) / spec.step) * spec.step;
  // Avoid float noise like 0.30000000000000004 in the UI / presets.
  return Number(snapped.toFixed(6));
}

function numberRange(spec: ParamSpec): [number, number] {
  const def = typeof spec.default === "number" ? spec.default : 0;
  return [spec.min ?? Math.min(0, def), spec.max ?? Math.max(1, def * 2 || 1)];
}

function randomColor(rng: () => number): string {
  // Random hue, pleasant fixed saturation/lightness band, as hex.
  const h = rng() * 360;
  const s = 0.55 + rng() * 0.35;
  const l = 0.5 + rng() * 0.2;
  return hslToHex(h, s, l);
}

export function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// ---------------------------------------------------------------------------
// Randomize / mutate
// ---------------------------------------------------------------------------

function randomValueFor(spec: ParamSpec, rng: () => number): ParamValue {
  switch (spec.type) {
    case "number": {
      const [lo, hi] = numberRange(spec);
      return snap(lo + rng() * (hi - lo), spec);
    }
    case "boolean":
      return rng() < 0.5;
    case "select": {
      const opts = spec.options ?? [];
      return opts.length ? opts[Math.floor(rng() * opts.length)] : spec.default;
    }
    case "color":
      return randomColor(rng);
    case "seed":
      return Math.floor(rng() * 100000);
    case "vec2":
    case "vec3": {
      const [lo, hi] = numberRange(spec);
      const n = spec.type === "vec2" ? 2 : 3;
      return Array.from({ length: n }, () => snap(lo + rng() * (hi - lo), spec));
    }
    case "range": {
      const [lo, hi] = numberRange(spec);
      const a = lo + rng() * (hi - lo);
      const b = lo + rng() * (hi - lo);
      return [snap(Math.min(a, b), spec), snap(Math.max(a, b), spec)];
    }
  }
}

/**
 * Fresh random values for every randomizable param; others keep `current`
 * (or the default when current is missing). Deterministic in `seed`.
 */
export function randomizeParams(
  def: VisualizerDefinition,
  current: ParamValues,
  seed: number,
): ParamValues {
  const out = { ...defaultParams(def), ...structuredClone(current) };
  // One RNG stream per param (keyed by seed + param key) so adding a new
  // param to a visualizer doesn't shift every other param's random value.
  for (const spec of def.params) {
    if (!spec.randomizable) continue;
    const rng = mulberry32(seed ^ hashString(spec.key));
    out[spec.key] = randomValueFor(spec, rng);
  }
  return out;
}

/**
 * Nudge randomizable params around their CURRENT values (±amount of the
 * full range for numbers; occasional flips for booleans/selects/colors).
 * Deterministic in `seed`.
 */
export function mutateParams(
  def: VisualizerDefinition,
  current: ParamValues,
  seed: number,
  amount = 0.15,
): ParamValues {
  const out = { ...defaultParams(def), ...structuredClone(current) };
  for (const spec of def.params) {
    if (!spec.randomizable) continue;
    const rng = mulberry32(seed ^ hashString(spec.key));
    const cur = out[spec.key];
    switch (spec.type) {
      case "number": {
        const [lo, hi] = numberRange(spec);
        const span = (hi - lo) * amount;
        const v = typeof cur === "number" ? cur : Number(spec.default);
        out[spec.key] = snap(clamp(v + (rng() * 2 - 1) * span, lo, hi), spec);
        break;
      }
      case "vec2":
      case "vec3":
      case "range": {
        const [lo, hi] = numberRange(spec);
        const span = (hi - lo) * amount;
        const arr = Array.isArray(cur) ? [...cur] : [...(spec.default as number[])];
        for (let i = 0; i < arr.length; i++) {
          arr[i] = snap(clamp(arr[i] + (rng() * 2 - 1) * span, lo, hi), spec);
        }
        if (spec.type === "range") arr.sort((a, b) => a - b);
        out[spec.key] = arr;
        break;
      }
      case "boolean":
        // Flip with probability = amount (a mutation should mostly keep).
        out[spec.key] = rng() < amount ? !cur : Boolean(cur);
        break;
      case "select": {
        const opts = spec.options ?? [];
        out[spec.key] =
          rng() < amount && opts.length
            ? opts[Math.floor(rng() * opts.length)]
            : cur;
        break;
      }
      case "color":
        out[spec.key] = rng() < amount * 2 ? randomColor(rng) : cur;
        break;
      case "seed":
        out[spec.key] = rng() < amount ? Math.floor(rng() * 100000) : cur;
        break;
    }
  }
  return out;
}

/**
 * Coerce/clamp arbitrary incoming values (imported presets, URL params)
 * against a definition's specs, falling back to defaults for junk.
 */
export function sanitizeParams(
  def: VisualizerDefinition,
  raw: ParamValues,
): ParamValues {
  const out = defaultParams(def);
  for (const spec of def.params) {
    const v = raw[spec.key];
    if (v === undefined) continue;
    switch (spec.type) {
      case "number":
      case "seed": {
        const n = Number(v);
        if (Number.isFinite(n)) {
          out[spec.key] = clamp(n, spec.min ?? -Infinity, spec.max ?? Infinity);
        }
        break;
      }
      case "boolean":
        out[spec.key] = Boolean(v);
        break;
      case "select":
        if (typeof v === "string" && (spec.options ?? []).includes(v)) {
          out[spec.key] = v;
        }
        break;
      case "color":
        if (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v)) {
          out[spec.key] = v.toLowerCase();
        }
        break;
      case "vec2":
      case "vec3":
      case "range": {
        const want = spec.type === "vec3" ? 3 : 2;
        if (Array.isArray(v) && v.length === want && v.every((x) => Number.isFinite(Number(x)))) {
          const arr = v.map((x) =>
            clamp(Number(x), spec.min ?? -Infinity, spec.max ?? Infinity));
          if (spec.type === "range") arr.sort((a, b) => a - b);
          out[spec.key] = arr;
        }
        break;
      }
    }
  }
  return out;
}
