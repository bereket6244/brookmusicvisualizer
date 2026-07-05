/**
 * Regression tests for the FluidSynth invocation and dependency
 * resolution chain (third pass).
 *
 * The arg-order test pins a confirmed Windows bug: output options (-F/-r)
 * placed AFTER the soundfont/MIDI positionals made FluidSynth ignore the
 * fast-render request and never write the WAV. The working shape is:
 *
 *   fluidsynth -ni -F out.wav -r 44100 soundfont.sf2 song.mid
 */

import { describe, expect, it } from "vitest";

import { audioStatus, buildFluidsynthArgs, resolveFluidsynth } from "./audio.js";

describe("buildFluidsynthArgs", () => {
  it("produces the confirmed working argument order", () => {
    expect(buildFluidsynthArgs("out.wav", "font.sf2", "song.mid")).toEqual(
      ["-ni", "-F", "out.wav", "-r", "44100", "font.sf2", "song.mid"],
    );
  });

  it("keeps output options BEFORE the positional soundfont/MIDI args", () => {
    const args = buildFluidsynthArgs("o.wav", "f.sf2", "m.mid");
    expect(args.indexOf("-F")).toBeLessThan(args.indexOf("f.sf2"));
    expect(args.indexOf("-r")).toBeLessThan(args.indexOf("f.sf2"));
    // soundfont must directly precede the MIDI file (both positional)
    expect(args.indexOf("f.sf2")).toBe(args.length - 2);
    expect(args.indexOf("m.mid")).toBe(args.length - 1);
  });
});

describe("dependency resolution", () => {
  it("always resolves some fluidsynth candidate (PATH is the last resort)", () => {
    const synth = resolveFluidsynth();
    expect(synth.path).toBeTruthy();
    expect(synth.source).toBeTruthy();
  });

  it("audioStatus returns the full structured report", () => {
    const status = audioStatus();
    expect(typeof status.ready).toBe("boolean");
    expect(status.fluidsynth).toHaveProperty("ok");
    expect(status.soundfont).toHaveProperty("ok");
    // when not ready there must be an actionable fix hint
    if (!status.ready) expect(status.fix).toMatch(/setup:audio/);
    // whichever way it resolved, failure reasons must exist for failures
    if (!status.fluidsynth.ok) expect(status.fluidsynth.reason).toBeTruthy();
    if (!status.soundfont.ok) expect(status.soundfont.reason).toBeTruthy();
  });
});
