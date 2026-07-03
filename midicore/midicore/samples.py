"""Generate small test/demo MIDI files with mido.

These let the whole project run out of the box without the user
supplying a MIDI file. `write_all(out_dir)` writes the .mid files;
the CLI also parses each one to a sibling .timeline.json.
"""

from __future__ import annotations

import os

import mido
from mido import Message, MetaMessage, MidiFile, MidiTrack

PPQ = 480  # ticks per quarter note used by all generated files


def _new_file(name: str, bpm: float = 120, numerator: int = 4,
              denominator: int = 4) -> tuple[MidiFile, MidiTrack]:
    mid = MidiFile(type=1, ticks_per_beat=PPQ)
    track = MidiTrack()
    mid.tracks.append(track)
    track.append(MetaMessage("track_name", name=name, time=0))
    track.append(MetaMessage("set_tempo", tempo=mido.bpm2tempo(bpm), time=0))
    track.append(MetaMessage("time_signature", numerator=numerator,
                             denominator=denominator, time=0))
    return mid, track


def single_note() -> MidiFile:
    """One C4 quarter note at 120 BPM: starts at 0s, lasts exactly 0.5s."""
    mid, track = _new_file("single note")
    track.append(Message("program_change", program=0, channel=0, time=0))
    track.append(Message("note_on", note=60, velocity=80, channel=0, time=0))
    track.append(Message("note_off", note=60, velocity=0, channel=0, time=PPQ))
    return mid


def chord() -> MidiFile:
    """C major triad struck together for a half note."""
    mid, track = _new_file("chord")
    for i, pitch in enumerate((60, 64, 67)):
        track.append(Message("note_on", note=pitch, velocity=90, channel=0, time=0))
    track.append(Message("note_off", note=60, velocity=0, channel=0, time=PPQ * 2))
    for pitch in (64, 67):
        track.append(Message("note_off", note=pitch, velocity=0, channel=0, time=0))
    return mid


def scale() -> MidiFile:
    """C major scale up one octave, eighth notes."""
    mid, track = _new_file("scale")
    for pitch in (60, 62, 64, 65, 67, 69, 71, 72):
        track.append(Message("note_on", note=pitch, velocity=76, channel=0, time=0))
        track.append(Message("note_off", note=pitch, velocity=0, channel=0,
                             time=PPQ // 2))
    return mid


def sustain_demo() -> MidiFile:
    """Two short notes played with the sustain pedal down.

    Keys are held for an eighth note each, but the pedal (CC64) stays
    down for two full beats, so the SOUNDING duration is much longer than
    the explicit key-held duration. Good for testing/eyeballing the
    explicit vs sounding distinction.
    """
    mid, track = _new_file("sustain demo")
    track.append(Message("control_change", control=64, value=127, channel=0, time=0))
    track.append(Message("note_on", note=60, velocity=85, channel=0, time=0))
    track.append(Message("note_off", note=60, velocity=0, channel=0, time=PPQ // 2))
    track.append(Message("note_on", note=67, velocity=85, channel=0, time=0))
    track.append(Message("note_off", note=67, velocity=0, channel=0, time=PPQ // 2))
    track.append(Message("control_change", control=64, value=0, channel=0, time=PPQ))
    # A pedal-free note afterwards for contrast.
    track.append(Message("note_on", note=72, velocity=85, channel=0, time=PPQ // 2))
    track.append(Message("note_off", note=72, velocity=0, channel=0, time=PPQ))
    return mid


def tempo_change() -> MidiFile:
    """Two quarter notes at 120 BPM, tempo doubles to 240, two more notes."""
    mid, track = _new_file("tempo change", bpm=120)
    for pitch in (60, 62):
        track.append(Message("note_on", note=pitch, velocity=80, channel=0, time=0))
        track.append(Message("note_off", note=pitch, velocity=0, channel=0, time=PPQ))
    track.append(MetaMessage("set_tempo", tempo=mido.bpm2tempo(240), time=0))
    for pitch in (64, 65):
        track.append(Message("note_on", note=pitch, velocity=80, channel=0, time=0))
        track.append(Message("note_off", note=pitch, velocity=0, channel=0, time=PPQ))
    return mid


def multitrack() -> MidiFile:
    """Melody (piano, ch0) + bass (cello, ch1) on separate tracks."""
    mid = MidiFile(type=1, ticks_per_beat=PPQ)

    conductor = MidiTrack()
    mid.tracks.append(conductor)
    conductor.append(MetaMessage("set_tempo", tempo=mido.bpm2tempo(100), time=0))
    conductor.append(MetaMessage("time_signature", numerator=3, denominator=4, time=0))

    melody = MidiTrack()
    mid.tracks.append(melody)
    melody.append(MetaMessage("track_name", name="Melody", time=0))
    melody.append(Message("program_change", program=0, channel=0, time=0))
    for pitch in (72, 74, 76, 74, 72, 71):
        melody.append(Message("note_on", note=pitch, velocity=88, channel=0, time=0))
        melody.append(Message("note_off", note=pitch, velocity=0, channel=0, time=PPQ // 2))

    bass = MidiTrack()
    mid.tracks.append(bass)
    bass.append(MetaMessage("track_name", name="Bass", time=0))
    bass.append(Message("program_change", program=42, channel=1, time=0))  # Cello
    for pitch in (48, 43, 48):
        bass.append(Message("note_on", note=pitch, velocity=70, channel=1, time=0))
        bass.append(Message("note_off", note=pitch, velocity=0, channel=1, time=PPQ))
    return mid


# First 8 bars of Bach's Prelude in C major, BWV 846 (public domain).
# Each bar is 5 pitches; the classic figuration arpeggiates them.
_PRELUDE_BARS = [
    ["C4", "E4", "G4", "C5", "E5"],
    ["C4", "D4", "A4", "D5", "F5"],
    ["B3", "D4", "G4", "D5", "F5"],
    ["C4", "E4", "G4", "C5", "E5"],
    ["C4", "E4", "A4", "E5", "A5"],
    ["C4", "D4", "F#4", "A4", "D5"],
    ["B3", "D4", "G4", "D5", "G5"],
    ["B3", "C4", "E4", "G4", "C5"],
]

_NAME_TO_PC = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5, "F#": 6,
               "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11}


def _name_to_pitch(name: str) -> int:
    # e.g. "F#4" -> 66. Octave follows the C4=60 convention.
    if name[1] == "#":
        pc, octave = _NAME_TO_PC[name[:2]], int(name[2:])
    else:
        pc, octave = _NAME_TO_PC[name[0]], int(name[1:])
    return (octave + 1) * 12 + pc


def prelude_c() -> MidiFile:
    """Bach Prelude in C (BWV 846), first 8 bars, with sustain pedal.

    Per bar: the lowest pitch is held as two half notes (left hand) while
    the upper four pitches run as the famous 16th-note figuration
    (p2 p3 p4 p5 p3 p4 p5 p3, twice per bar). The sustain pedal is held
    down for each bar and released at the bar line, which is how the
    piece is commonly pedaled — and it exercises the parser's
    explicit-vs-sounding duration logic on real music.
    """
    mid, track = _new_file("Prelude in C (BWV 846)", bpm=66)
    track.append(Message("program_change", program=0, channel=0, time=0))
    sixteenth = PPQ // 4
    for pitches in _PRELUDE_BARS:
        p = [_name_to_pitch(n) for n in pitches]
        track.append(Message("control_change", control=64, value=127,
                             channel=0, time=0))
        for half in range(2):  # the figuration repeats within the bar
            # Left hand: bass note struck at the start of each half bar,
            # key released after one 16th (the pedal carries it).
            track.append(Message("note_on", note=p[0], velocity=68,
                                 channel=0, time=0))
            events_this_half = [p[1], p[2], p[3], p[4], p[2], p[3], p[4], p[2]]
            bass_open = True
            for i, pitch in enumerate(events_this_half):
                track.append(Message("note_on", note=pitch, velocity=80,
                                     channel=0, time=0))
                track.append(Message("note_off", note=pitch, velocity=0,
                                     channel=0, time=sixteenth))
                if bass_open:
                    track.append(Message("note_off", note=p[0], velocity=0,
                                         channel=0, time=0))
                    bass_open = False
        track.append(Message("control_change", control=64, value=0,
                             channel=0, time=0))
    return mid


GENERATORS = {
    "single_note": single_note,
    "chord": chord,
    "scale": scale,
    "sustain_demo": sustain_demo,
    "tempo_change": tempo_change,
    "multitrack": multitrack,
    "prelude_c": prelude_c,
}


def write_all(out_dir: str) -> list[str]:
    os.makedirs(out_dir, exist_ok=True)
    paths = []
    for name, gen in GENERATORS.items():
        path = os.path.join(out_dir, f"{name}.mid")
        gen().save(path)
        paths.append(path)
    return paths
