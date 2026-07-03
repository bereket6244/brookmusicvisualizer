# Timeline JSON — field documentation

The timeline is the project's single interchange format, produced by
`python -m midicore parse <file.mid>`. This page explains every important
field in plain language. If a MIDI term is unfamiliar, it is defined in
[GLOSSARY.md](GLOSSARY.md). A machine-readable JSON Schema is generated at
[timeline.schema.json](timeline.schema.json) (`python -m midicore schema`).

All `*_seconds` values are real-time seconds from the start of the piece,
already adjusted for every tempo change. All `*_tick` values are absolute
MIDI ticks from the start. Visualizers should use seconds; ticks are kept
for traceability and musical math.

## Top level

| field | meaning |
|---|---|
| `format` | always `"midicore-timeline"` — sanity marker |
| `format_version` | schema version of this file (`"1.0"`) |
| `meta` | file-level facts (below) |
| `tempo_map` | every tempo in effect, in order |
| `time_signature_map` | every time signature in effect, in order |
| `tracks` | per-track summaries |
| `sustain_events` | every sustain-pedal (CC64) event |
| `notes` | the flat list of every note — the main payload |

## `meta`

| field | meaning |
|---|---|
| `source_file` | original MIDI filename (basename only) |
| `parsed_at` | local timestamp of parsing |
| `midi_format` | MIDI file type 0/1/2 |
| `ticks_per_beat` | PPQ — how many ticks one quarter note lasts (see glossary) |
| `duration_seconds` | full piece length incl. sustain tails and trailing events |
| `duration_ticks` | tick of the last event in the file |
| `note_count` | number of entries in `notes` |
| `track_count` | number of entries in `tracks` |
| `has_sustain_data` | `true` if the file contained any CC64 events; when `false`, explicit and sounding durations are identical everywhere |
| `unterminated_notes` | count of notes that had no note-off (closed at end of file and flagged) |

## `tempo_map[]`

Each entry marks a point where the tempo changes (first entry is the
initial tempo; MIDI's default 120 BPM is inserted if the file sets none).

| field | meaning |
|---|---|
| `tick` / `seconds` | when this tempo takes effect |
| `tempo_us_per_beat` | raw MIDI value: microseconds per quarter note |
| `bpm` | the same value as beats per minute (60 000 000 / tempo) |

## `time_signature_map[]`

| field | meaning |
|---|---|
| `tick` / `seconds` | when this signature takes effect |
| `numerator` / `denominator` | e.g. 3/4, 6/8 (default 4/4 if unset) |
| `bar` | the 1-based bar number that starts at this point |

## `tracks[]`

| field | meaning |
|---|---|
| `index` | track position in the file (0-based) |
| `name` | track name meta event, or `""` |
| `channels` | MIDI channels this track used |
| `programs` | per channel: last program number + General MIDI instrument name (or `null` if the file never set one) |
| `note_count` | notes originating from this track |

## `sustain_events[]`

Every CC64 message, normalized:

| field | meaning |
|---|---|
| `tick` / `seconds` | when |
| `channel` | which channel's pedal |
| `value` | raw 0–127 controller value |
| `pedal_down` | convenience: `value >= 64` |
| `track` | track that carried the message |

## `notes[]` — the main payload

Sorted by start time. Each note is one key press:

| field | meaning |
|---|---|
| `id` | stable index (0-based, in start order) |
| `pitch` | MIDI pitch number 0–127; **60 = middle C** |
| `name` | human name with octave, e.g. `"C4"`, `"F#3"` |
| `note_name` | pitch class only, e.g. `"C"`, `"F#"` (sharps spelling) |
| `octave` | octave number (C4 convention: `pitch // 12 - 1`) |
| `velocity` | how hard the key was struck, 1–127 |
| `track` / `track_name` | which track the note came from |
| `channel` | MIDI channel 0–15 |
| `program` / `instrument` | GM program number and name at note start, or `null` if the file never set one |
| `start_tick`, `start_seconds` | when the key went down |
| `end_tick_explicit`, `end_seconds_explicit` | when the key was **released** (note-off) |
| `end_tick_sounding`, `end_seconds_sounding` | when the note **stopped sounding** — equals the explicit end unless the sustain pedal was down at key release, in which case it extends to the pedal release |
| `duration_ticks_explicit`, `duration_seconds_explicit` | key-held duration |
| `duration_ticks_sounding`, `duration_seconds_sounding` | audible duration incl. pedal |
| `sustained` | `true` if the pedal extended this note (`sounding > explicit`) |
| `bar`, `beat` | musical position of the note start; both 1-based, `beat` fractional (beat 2.5 = halfway between beats 2 and 3) |
| `unterminated` | present + `true` only for notes force-closed at end of file |

**The explicit/sounding pair is the point of this format.** A pianist can
tap a key for 50 ms while the pedal lets it ring for four seconds; a
visualizer may want to draw those two things differently (the demo
visualizer does: opaque core = held, translucent halo = pedal tail).

## Guarantees

- `notes` sorted ascending by `start_seconds`.
- `start ≤ end_explicit ≤ end_sounding` for every note (tick and seconds).
- Every `*_seconds` respects every tempo change in `tempo_map`.
- Time intervals are treated half-open `[start, end)` by both timing
  engines.
- `validate_timeline()` / `python -m midicore validate` checks the
  structural contract above.
