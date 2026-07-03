import mido
import pytest
from mido import Message, MetaMessage, MidiFile, MidiTrack

from midicore.parser import parse_midi

PPQ = 480


def build_and_parse(tmp_path, tracks_messages, ticks_per_beat=PPQ):
    """Build a MIDI file from lists of messages (one list per track),
    save it to a temp file, and parse it with midicore."""
    mid = MidiFile(type=1, ticks_per_beat=ticks_per_beat)
    for messages in tracks_messages:
        track = MidiTrack()
        track.extend(messages)
        mid.tracks.append(track)
    path = tmp_path / "test.mid"
    mid.save(path)
    return parse_midi(str(path))


@pytest.fixture
def make_midi(tmp_path):
    def _make(*tracks_messages, ticks_per_beat=PPQ):
        return build_and_parse(tmp_path, tracks_messages, ticks_per_beat)
    return _make


def tempo(bpm, time=0):
    return MetaMessage("set_tempo", tempo=mido.bpm2tempo(bpm), time=time)


def timesig(num, den, time=0):
    return MetaMessage("time_signature", numerator=num, denominator=den, time=time)


def on(note, vel=80, ch=0, time=0):
    return Message("note_on", note=note, velocity=vel, channel=ch, time=time)


def off(note, ch=0, time=0):
    return Message("note_off", note=note, velocity=0, channel=ch, time=time)


def cc64(value, ch=0, time=0):
    return Message("control_change", control=64, value=value, channel=ch, time=time)
