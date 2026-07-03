/**
 * Musical annotations — a sidecar JSON format for labels MIDI cannot
 * provide: fugue subject entries, voices, motifs, sections, arbitrary tags.
 *
 * MIDI knows tracks/channels/pitches/timing; it does NOT know "this is the
 * subject" or "this is Voice A". Those are analysis decisions a human (or a
 * future analysis tool) records in a `*.annotations.json` file next to the
 * timeline. Visualizers query them through AnnotationSet.
 *
 * Format spec: docs/ANNOTATIONS.md. Example: samples/prelude_c.annotations.json
 */

export interface AnnotationLabel {
  id: string;
  /** Free vocabulary; suggested types: motif, voice, section, phrase, custom. */
  type: string;
  name: string;
  /** Time range the label covers. end_seconds may be omitted for markers. */
  start_seconds: number;
  end_seconds?: number;
  /** Optional scoping — when present the label applies only to that
   * track/channel (e.g. "subject entry in the alto voice = track 2"). */
  track?: number;
  channel?: number;
  /** Note ids (timeline note `id` field) this label points at, if any. */
  note_ids?: number[];
  tags?: string[];
  /** Anything else a future analysis layer wants to attach. */
  data?: Record<string, unknown>;
}

export interface AnnotationFile {
  format: "music-visualizer-annotations";
  version: string;
  /** Optional pointer to the timeline this annotates (informational). */
  timeline?: string;
  labels: AnnotationLabel[];
}

/** Parse + validate an annotation JSON payload; throws with a clear message. */
export function parseAnnotations(json: unknown): AnnotationSet {
  const file = json as AnnotationFile;
  if (file?.format !== "music-visualizer-annotations") {
    throw new Error('not an annotations file (expected format: "music-visualizer-annotations")');
  }
  if (!Array.isArray(file.labels)) throw new Error("annotations file has no labels array");
  for (const l of file.labels) {
    if (typeof l.id !== "string" || typeof l.start_seconds !== "number") {
      throw new Error(`label ${JSON.stringify(l.id ?? "?")} needs string id + numeric start_seconds`);
    }
  }
  return new AnnotationSet(file);
}

/**
 * Query API over one annotation file. Labels are kept sorted by start time;
 * all range queries treat labels as half-open [start, end) like notes, with
 * end defaulting to start (instant marker) when omitted.
 */
export class AnnotationSet {
  readonly file: AnnotationFile;
  readonly labels: AnnotationLabel[];

  constructor(file: AnnotationFile) {
    this.file = file;
    this.labels = [...file.labels].sort((a, b) => a.start_seconds - b.start_seconds);
  }

  private end(l: AnnotationLabel): number {
    return l.end_seconds ?? l.start_seconds;
  }

  /** Labels whose [start, end) contains t (markers match at exactly t). */
  labelsAt(t: number): AnnotationLabel[] {
    return this.labels.filter(
      (l) => l.start_seconds <= t && (t < this.end(l) || this.end(l) === l.start_seconds && t === l.start_seconds),
    );
  }

  /** Labels overlapping the window [t0, t1). */
  labelsOverlapping(t0: number, t1: number): AnnotationLabel[] {
    return this.labels.filter((l) => l.start_seconds < t1 && this.end(l) > t0
      || (this.end(l) === l.start_seconds && l.start_seconds >= t0 && l.start_seconds < t1));
  }

  labelsOfType(type: string): AnnotationLabel[] {
    return this.labels.filter((l) => l.type === type);
  }

  labelsWithTag(tag: string): AnnotationLabel[] {
    return this.labels.filter((l) => l.tags?.includes(tag));
  }

  labelsForTrack(track: number): AnnotationLabel[] {
    return this.labels.filter((l) => l.track === track);
  }

  /** Labels of a type that reference a given note id. */
  labelsForNote(noteId: number): AnnotationLabel[] {
    return this.labels.filter((l) => l.note_ids?.includes(noteId));
  }

  get(id: string): AnnotationLabel | undefined {
    return this.labels.find((l) => l.id === id);
  }
}
