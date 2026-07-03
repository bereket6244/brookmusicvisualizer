/**
 * TypeScript types for the midicore timeline JSON — the project's
 * interchange format, produced by `python -m midicore parse`.
 * Field semantics are documented in docs/SCHEMA.md.
 */

export interface TimelineNote {
  id: number;
  pitch: number;          // MIDI pitch number, 0-127; 60 = middle C (C4)
  name: string;           // e.g. "C4"
  note_name: string;      // e.g. "C"
  octave: number;
  velocity: number;       // 1-127
  track: number;
  track_name: string;
  channel: number;        // 0-15
  program: number | null;
  instrument: string | null;
  start_tick: number;
  end_tick_explicit: number;   // key released
  end_tick_sounding: number;   // sound stops (after sustain pedal)
  duration_ticks_explicit: number;
  duration_ticks_sounding: number;
  start_seconds: number;
  end_seconds_explicit: number;
  end_seconds_sounding: number;
  duration_seconds_explicit: number;
  duration_seconds_sounding: number;
  sustained: boolean;     // true if the pedal extended this note
  bar: number;            // 1-based
  beat: number;           // 1-based, fractional
  unterminated?: boolean;
  /** Pedal tail was cut short because the same pitch was struck again
   * on the same channel (format_version >= 1.1). */
  restruck?: boolean;
}

export interface TempoMapEntry {
  tick: number;
  seconds: number;
  tempo_us_per_beat: number;
  bpm: number;
}

export interface TimeSignatureEntry {
  tick: number;
  seconds: number;
  numerator: number;
  denominator: number;
  bar: number;
}

export interface TimelineTrack {
  index: number;
  name: string;
  channels: number[];
  programs: { channel: number; program: number | null; name: string | null }[];
  note_count: number;
}

export interface SustainEvent {
  tick: number;
  seconds: number;
  channel: number;
  value: number;
  pedal_down: boolean;
  track: number;
}

export interface TimelineMeta {
  source_file: string;
  parsed_at?: string;
  midi_format?: number;
  ticks_per_beat: number;
  duration_seconds: number;
  duration_ticks: number;
  note_count: number;
  track_count: number;
  has_sustain_data: boolean;
  unterminated_notes?: number;
}

export interface Timeline {
  format: "midicore-timeline";
  format_version: string;
  meta: TimelineMeta;
  tempo_map: TempoMapEntry[];
  time_signature_map: TimeSignatureEntry[];
  tracks: TimelineTrack[];
  sustain_events: SustainEvent[];
  notes: TimelineNote[];
}
