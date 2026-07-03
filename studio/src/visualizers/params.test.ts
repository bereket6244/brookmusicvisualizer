import { describe, expect, it } from "vitest";

import {
  hashString,
  mulberry32,
  mutateParams,
  randomizeParams,
  sanitizeParams,
} from "./params";
import type { VisualizerDefinition } from "./types";
import { defaultParams } from "./types";

// A fake definition exercising every param type; create() is never called.
const def: VisualizerDefinition = {
  id: "test-viz",
  name: "Test",
  description: "",
  renderMode: "2d",
  create() {
    throw new Error("not used in these tests");
  },
  params: [
    { key: "size", label: "Size", type: "number", default: 10,
      min: 0, max: 100, step: 1, randomizable: true },
    { key: "fixed", label: "Fixed", type: "number", default: 5,
      min: 0, max: 10 }, // NOT randomizable
    { key: "tint", label: "Tint", type: "color", default: "#112233",
      randomizable: true },
    { key: "flag", label: "Flag", type: "boolean", default: false,
      randomizable: true },
    { key: "mode", label: "Mode", type: "select", default: "a",
      options: ["a", "b", "c"], randomizable: true },
    { key: "offset", label: "Offset", type: "vec2", default: [1, 2],
      min: -10, max: 10, randomizable: true },
    { key: "window", label: "Window", type: "range", default: [2, 8],
      min: 0, max: 10, randomizable: true },
    { key: "seed", label: "Seed", type: "seed", default: 42, randomizable: true },
  ],
};

describe("seeded RNG", () => {
  it("mulberry32 is deterministic and in [0,1)", () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    for (let i = 0; i < 100; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });

  it("hashString is stable", () => {
    expect(hashString("0/0/60/0/0")).toBe(hashString("0/0/60/0/0"));
    expect(hashString("a")).not.toBe(hashString("b"));
  });
});

describe("randomizeParams", () => {
  it("same seed -> identical result (reproducible accidents)", () => {
    const base = defaultParams(def);
    const r1 = randomizeParams(def, base, 777);
    const r2 = randomizeParams(def, base, 777);
    expect(r1).toEqual(r2);
  });

  it("different seeds -> different results", () => {
    const base = defaultParams(def);
    expect(randomizeParams(def, base, 1)).not.toEqual(randomizeParams(def, base, 2));
  });

  it("never touches non-randomizable params", () => {
    const base = { ...defaultParams(def), fixed: 7 };
    for (let seed = 0; seed < 20; seed++) {
      expect(randomizeParams(def, base, seed).fixed).toBe(7);
    }
  });

  it("respects bounds, option lists, and range ordering", () => {
    for (let seed = 0; seed < 50; seed++) {
      const r = randomizeParams(def, defaultParams(def), seed);
      expect(r.size).toBeGreaterThanOrEqual(0);
      expect(r.size).toBeLessThanOrEqual(100);
      expect(Number.isInteger(r.size)).toBe(true); // step: 1
      expect(["a", "b", "c"]).toContain(r.mode);
      expect(String(r.tint)).toMatch(/^#[0-9a-f]{6}$/);
      const [lo, hi] = r.window as number[];
      expect(lo).toBeLessThanOrEqual(hi);
    }
  });
});

describe("mutateParams", () => {
  it("is deterministic in the seed", () => {
    const base = { ...defaultParams(def), size: 50 };
    expect(mutateParams(def, base, 99)).toEqual(mutateParams(def, base, 99));
  });

  it("nudges numbers within amount * span of the current value", () => {
    const base = { ...defaultParams(def), size: 50 };
    for (let seed = 0; seed < 30; seed++) {
      const m = mutateParams(def, base, seed, 0.1);
      expect(Math.abs(Number(m.size) - 50)).toBeLessThanOrEqual(10 + 1e-9);
      expect(m.fixed).toBe(5); // untouched
    }
  });
});

describe("sanitizeParams", () => {
  it("clamps numbers and rejects junk", () => {
    const out = sanitizeParams(def, {
      size: 9999,          // clamped to max
      mode: "nope",        // invalid option -> default
      tint: "javascript:", // invalid color -> default
      offset: [999, -999], // clamped per component
      flag: 1 as unknown as boolean,
    });
    expect(out.size).toBe(100);
    expect(out.mode).toBe("a");
    expect(out.tint).toBe("#112233");
    expect(out.offset).toEqual([10, -10]);
    expect(out.flag).toBe(true);
  });

  it("keeps valid values and fills missing with defaults", () => {
    const out = sanitizeParams(def, { size: 33 });
    expect(out.size).toBe(33);
    expect(out.window).toEqual([2, 8]);
  });
});
