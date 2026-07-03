/**
 * Mirrors midicore/tests/test_timing.py: same fixture layout, same
 * expectations, proving the two engine implementations agree.
 *
 * Fixture at 120 BPM:
 *   C4: key 0.0 -> 0.25s, pedal sustains sound to 1.0s
 *   E4: 0.5 -> 1.5s plain
 *   G4: 1.0 -> 1.25s plain
 */

import { describe, expect, it } from "vitest";

import type { Timeline, TimelineNote } from "./timeline-types";
import { TimingEngine } from "./timing-engine";

function note(over: Partial<TimelineNote>): TimelineNote {
  return {
    id: 0, pitch: 60, name: "C4", note_name: "C", octave: 4, velocity: 80,
    track: 0, track_name: "", channel: 0, program: 0,
    instrument: "Acoustic Grand Piano",
    start_tick: 0, end_tick_explicit: 0, end_tick_sounding: 0,
    duration_ticks_explicit: 0, duration_ticks_sounding: 0,
    start_seconds: 0, end_seconds_explicit: 0, end_seconds_sounding: 0,
    duration_seconds_explicit: 0, duration_seconds_sounding: 0,
    sustained: false, bar: 1, beat: 1,
    ...over,
  };
}

const timeline: Timeline = {
  format: "midicore-timeline",
  format_version: "1.0",
  meta: {
    source_file: "fixture.mid", ticks_per_beat: 480,
    duration_seconds: 1.5, duration_ticks: 1440,
    note_count: 3, track_count: 1, has_sustain_data: true,
  },
  tempo_map: [{ tick: 0, seconds: 0, tempo_us_per_beat: 500000, bpm: 120 }],
  time_signature_map: [
    { tick: 0, seconds: 0, numerator: 4, denominator: 4, bar: 1 },
  ],
  tracks: [],
  sustain_events: [],
  notes: [
    note({ id: 0, pitch: 60, name: "C4",
      start_seconds: 0, end_seconds_explicit: 0.25, end_seconds_sounding: 1.0,
      sustained: true }),
    note({ id: 1, pitch: 64, name: "E4", note_name: "E",
      start_seconds: 0.5, end_seconds_explicit: 1.5, end_seconds_sounding: 1.5 }),
    note({ id: 2, pitch: 67, name: "G4", note_name: "G",
      start_seconds: 1.0, end_seconds_explicit: 1.25, end_seconds_sounding: 1.25 }),
  ],
};

const engine = new TimingEngine(timeline);
const names = (notes: TimelineNote[]) => notes.map((n) => n.name).sort();

describe("TimingEngine", () => {
  it("reports duration", () => {
    expect(engine.durationSeconds).toBe(1.5);
  });

  it("active includes sustained tails; intervals are half-open", () => {
    expect(names(engine.notesActiveAt(0.5))).toEqual(["C4", "E4"]);
    expect(names(engine.notesActiveAt(1.0))).toEqual(["E4", "G4"]);
  });

  it("distinguishes held from pedal-sustained", () => {
    expect(names(engine.notesHeldAt(0.1))).toEqual(["C4"]);
    expect(names(engine.notesHeldAt(0.5))).toEqual(["E4"]);
    expect(names(engine.notesSustainedAt(0.5))).toEqual(["C4"]);
    expect(names(engine.notesSustainedAt(0.1))).toEqual([]);
  });

  it("finds notes starting/ending in a window", () => {
    expect(names(engine.notesStartingBetween(0, 0.6))).toEqual(["C4", "E4"]);
    expect(names(engine.notesStartingBetween(0.5, 0.5))).toEqual([]);
    expect(names(engine.notesEndingBetween(0.9, 1.1, true))).toEqual(["C4"]);
    expect(names(engine.notesEndingBetween(0.2, 0.3, false))).toEqual(["C4"]);
  });

  it("answers tempo and bar/beat", () => {
    expect(engine.tempoAt(0.7).bpm).toBe(120);
    expect(engine.barBeatAt(0)).toEqual({ bar: 1, beat: 1 });
    const { bar, beat } = engine.barBeatAt(1.0); // 2 quarters in = beat 3
    expect(bar).toBe(1);
    expect(beat).toBeCloseTo(3);
  });

  it("groups notes", () => {
    expect([...engine.notesByChannel().keys()]).toEqual([0]);
    expect(engine.notesByTrack().get(0)!.length).toBe(3);
  });
});
