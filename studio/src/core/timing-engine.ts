/**
 * Renderer-agnostic timing/state query engine over a timeline.
 *
 * TypeScript twin of midicore/timing.py — same semantics, same tests.
 * Visualizers NEVER parse MIDI or do tick math themselves; they ask this
 * engine questions about musical state at an explicit timestamp.
 *
 * All times are seconds. Intervals are half-open [start, end): a note
 * that ends exactly at t is NOT active at t.
 */

import type {
  TempoMapEntry,
  Timeline,
  TimelineNote,
  TimeSignatureEntry,
} from "./timeline-types";

export class TimingEngine {
  readonly timeline: Timeline;
  /** Notes sorted by start_seconds (the parser already emits them sorted). */
  readonly notes: TimelineNote[];
  private readonly starts: number[];

  constructor(timeline: Timeline) {
    this.timeline = timeline;
    this.notes = [...timeline.notes].sort(
      (a, b) => a.start_seconds - b.start_seconds,
    );
    this.starts = this.notes.map((n) => n.start_seconds);
  }

  get durationSeconds(): number {
    return this.timeline.meta.duration_seconds;
  }

  // -- note-state queries ---------------------------------------------------

  /** Notes sounding at t, including pedal-sustained tails. */
  notesActiveAt(t: number): TimelineNote[] {
    return this.scan(t, (n) => n.end_seconds_sounding);
  }

  /** Notes whose key is physically held at t. */
  notesHeldAt(t: number): TimelineNote[] {
    return this.scan(t, (n) => n.end_seconds_explicit);
  }

  /** Notes sounding at t only because the sustain pedal is down. */
  notesSustainedAt(t: number): TimelineNote[] {
    return this.notesActiveAt(t).filter((n) => n.end_seconds_explicit <= t);
  }

  /** Notes with t0 <= start < t1. */
  notesStartingBetween(t0: number, t1: number): TimelineNote[] {
    return this.notes.slice(
      lowerBound(this.starts, t0),
      lowerBound(this.starts, t1),
    );
  }

  /** Notes with t0 <= end < t1. */
  notesEndingBetween(t0: number, t1: number, sounding = true): TimelineNote[] {
    const end = sounding
      ? (n: TimelineNote) => n.end_seconds_sounding
      : (n: TimelineNote) => n.end_seconds_explicit;
    return this.notes.filter((n) => t0 <= end(n) && end(n) < t1);
  }

  private scan(t: number, end: (n: TimelineNote) => number): TimelineNote[] {
    // Only notes with start <= t can be active — binary search that prefix,
    // then filter by end time. O(actives + log n) would need an interval
    // tree; O(prefix) is plenty for typical piece sizes (<10k notes).
    const hi = upperBound(this.starts, t);
    const out: TimelineNote[] = [];
    for (let i = 0; i < hi; i++) {
      if (end(this.notes[i]) > t) out.push(this.notes[i]);
    }
    return out;
  }

  // -- musical context --------------------------------------------------------

  tempoAt(t: number): TempoMapEntry {
    return atOrBefore(this.timeline.tempo_map, t);
  }

  timeSignatureAt(t: number): TimeSignatureEntry {
    return atOrBefore(this.timeline.time_signature_map, t);
  }

  /** Invert the tempo map: seconds -> absolute tick (fractional). */
  secondsToTick(t: number): number {
    const seg = this.tempoAt(t);
    const ppq = this.timeline.meta.ticks_per_beat;
    return seg.tick + ((t - seg.seconds) * 1_000_000 * ppq) / seg.tempo_us_per_beat;
  }

  /** (bar, beat) at time t; both 1-based, beat fractional. */
  barBeatAt(t: number): { bar: number; beat: number } {
    const tick = this.secondsToTick(t);
    const sig = this.timeSignatureAt(t);
    const ppq = this.timeline.meta.ticks_per_beat;
    const ticksPerDenomBeat = (ppq * 4) / sig.denominator;
    const ticksPerBar = sig.numerator * ticksPerDenomBeat;
    const ticksIn = tick - sig.tick;
    return {
      bar: sig.bar + Math.floor(ticksIn / ticksPerBar),
      beat: (ticksIn % ticksPerBar) / ticksPerDenomBeat + 1,
    };
  }

  // -- grouping -----------------------------------------------------------------

  notesByTrack(): Map<number, TimelineNote[]> {
    return groupBy(this.notes, (n) => n.track);
  }

  notesByChannel(): Map<number, TimelineNote[]> {
    return groupBy(this.notes, (n) => n.channel);
  }

  notesByInstrument(): Map<string, TimelineNote[]> {
    return groupBy(this.notes, (n) => n.instrument ?? "Unknown");
  }
}

// -- helpers ---------------------------------------------------------------

/** First index i where arr[i] >= x. */
function lowerBound(arr: number[], x: number): number {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** First index i where arr[i] > x. */
function upperBound(arr: number[], x: number): number {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Last map entry whose .seconds <= t (entries sorted by seconds). */
function atOrBefore<T extends { seconds: number }>(entries: T[], t: number): T {
  let result = entries[0];
  for (const e of entries) {
    if (e.seconds <= t) result = e;
    else break;
  }
  return result;
}

function groupBy<K, T>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}
