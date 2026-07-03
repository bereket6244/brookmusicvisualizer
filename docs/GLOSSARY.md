# MIDI / timing glossary

Written for someone who knows music and programming but not MIDI
internals. These are the concepts behind the timeline JSON fields
([SCHEMA.md](SCHEMA.md)).

### MIDI file
Not audio. A MIDI file is a list of timed *instructions* — "press this
key now, this hard", "release it", "change tempo" — like sheet music for
machines. To hear it you need a synthesizer plus instrument sounds (see
*SoundFont* below).

### Tick
The clock unit inside a MIDI file. Ticks are *musical* time, not real
time: a tick's length in seconds depends on the current tempo. All rhythm
in the file is expressed in ticks.

### Delta ticks
How events are actually stored: each event carries the number of ticks
*since the previous event* on its track. Parsers accumulate these into…

### Absolute ticks
Ticks counted from the start of the piece. The parser converts all delta
times to absolute ticks first; every `*_tick` field in the timeline is
absolute.

### PPQ / ticks per beat
"Pulses per quarter note" — how many ticks one quarter note lasts
(`meta.ticks_per_beat`, commonly 480 or 960). With PPQ 480, an eighth note
is 240 ticks regardless of tempo.

### Tempo / tempo map
MIDI stores tempo as **microseconds per quarter note** (500 000 µs = 120
BPM). A piece may change tempo any number of times; the ordered list of
changes is the *tempo map*. Nothing about a note's tick position changes
when tempo changes — only how long those ticks take in real time.

### Converting ticks to seconds
Walk the tempo map segment by segment:
`seconds(tick) = seconds_at_last_tempo_change + (tick - change_tick) × tempo_µs / (PPQ × 10⁶)`.
The parser does this once for every event, which is why visualizers can
work purely in seconds.

### Note-on / note-off pairing
A note is stored as two separate events: `note_on` (key down) and
`note_off` (key up) with the same pitch and channel. The parser pairs them
into one note record. Two quirks it handles:
- **`note_on` with velocity 0 means `note_off`** — an extremely common
  space-saving convention.
- If the same pitch is struck again before being released, note-offs are
  paired first-in-first-out with the open notes.

### Velocity
How hard the key was struck, 1–127. Usually mapped to loudness/brightness.
(Velocity 0 is not "silent" — it means note-off, see above.)

### Channel
One of 16 lanes (0–15) inside the MIDI stream. Classically each channel
plays one instrument. Channel 9 is percussion by GM convention.

### Track
A storage/organization grouping in the file (e.g. one track per staff or
instrument part). Tracks are independent of channels, though simple files
often use one channel per track.

### Program / instrument
A `program_change` event selects which of the 128 **General MIDI**
instruments a channel plays (0 = Acoustic Grand Piano, 40 = Violin…).
The timeline resolves each note's program to a human-readable
`instrument` name.

### Pitch number
The MIDI key number 0–127. One step = one semitone. A4 (concert 440 Hz)
is 69.

### Note name and octave
`pitch 60 = C4`, and octave boundaries fall at C. This project spells
accidentals as sharps (`F#4`, not `Gb4`). Formula: `octave = pitch/12 - 1`.

### Middle C
MIDI pitch 60 (C4 here; some vendors call it C3 — conventions differ, ours
is the common C4 one). The demo visualizer uses distance-from-60 for its
radial layout.

### Bar / beat
Derived from the time signature map: with 4/4 at PPQ 480, a bar is 1920
ticks. `bar` is 1-based; `beat` is 1-based and fractional (beat 2.5 =
halfway between beats 2 and 3).

### Explicit duration vs sounding duration
*Explicit* = key press to key release (note-on to note-off). *Sounding* =
until the sound actually stops, which can be later if the sustain pedal
was down at key release. The timeline stores both so a visualizer can
distinguish a pianist physically holding a chord from the pedal letting it
ring.

### Sustain pedal / CC64
Controller change #64 is the sustain (damper) pedal: value ≥ 64 = pedal
down, < 64 = pedal up. While down, notes keep ringing after their key is
released, until the pedal comes up — or until the same pitch is struck
again (a *re-strike*: the new hammer replaces the old vibration; such cut
notes are flagged `restruck`). The parser turns pedal data into per-note
`end_*_sounding` extensions and keeps the raw events (including
*half-pedal* values between the extremes) in `sustain_events`. For
durations the standard ≥64 threshold is used; the in-between values are
preserved for visualizers that want them. Files without CC64 data simply
have `has_sustain_data: false`.

### SoundFont
A file of sampled instrument sounds (`.sf2`) that a synthesizer like
FluidSynth uses to turn MIDI instructions into audio. Free ones exist
(e.g. GeneralUser GS). Needed only for the optional audio render path.

### Frame timestamp (this project's core rule)
Offline rendering never "plays" anything: frame `n` of a video at `fps`
frames per second depicts the piece at exactly `t = n / fps` seconds.
Every visualizer draws its complete state for a given `t`, which makes
output reproducible on any machine at any speed.
