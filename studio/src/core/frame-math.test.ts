import { describe, expect, it } from "vitest";

import { frameCount, frameTime } from "./frame-math";

describe("frame math (t = frame / fps)", () => {
  it("maps frame numbers to timestamps", () => {
    expect(frameTime(0, 30)).toBe(0);
    expect(frameTime(30, 30)).toBe(1);
    expect(frameTime(45, 30)).toBe(1.5);
    expect(frameTime(1, 60)).toBeCloseTo(1 / 60);
  });

  it("computes frame counts with optional tail", () => {
    expect(frameCount(1.5, 30)).toBe(45);
    expect(frameCount(1.5, 30, 1.0)).toBe(75);
    expect(frameCount(0.01, 30)).toBe(1); // always at least one frame of content
    // 10-minute piece at 30 fps = 18000 frames (the docs' sizing example).
    expect(frameCount(600, 30)).toBe(18000);
  });
});
