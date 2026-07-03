"""Parser tests. PPQ is 480 everywhere; at 120 BPM one quarter note
(480 ticks) is exactly 0.5 seconds — that arithmetic anchors most asserts."""

import pytest
from mido import Message, MetaMessage

from midicore.schema import validate_timeline

from conftest import PPQ, cc64, off, on, tempo, timesig


def test_single_note_manually_specified_expected_output(make_midi):
    """The tiny-file golden test: every important field is asserted
    against hand-computed values."""
    tl = make_midi([tempo(120), timesig(4, 4),
                    Message("program_change", program=0, channel=0, time=0),
                    on(60, vel=80), off(60, time=480)])

    assert tl["format"] == "midicore-timeline"
    assert tl["meta"]["ticks_per_beat"] == 480
    assert tl["meta"]["note_count"] == 1
    assert tl["meta"]["has_sustain_data"] is False

    n = tl["notes"][0]
    assert n == {
        "id": 0,
        "pitch": 60,
        "name": "C4",
        "note_name": "C",
        "octave": 4,
        "velocity": 80,
        "track": 0,
        "track_name": "",
        "channel": 0,
        "program": 0,
        "instrument": "Acoustic Grand Piano",
        "start_tick": 0,
        "end_tick_explicit": 480,
        "end_tick_sounding": 480,
        "duration_ticks_explicit": 480,
        "duration_ticks_sounding": 480,
        "start_seconds": 0.0,
        "end_seconds_explicit": 0.5,
        "end_seconds_sounding": 0.5,
        "duration_seconds_explicit": 0.5,
        "duration_seconds_sounding": 0.5,
        "sustained": False,
        "bar": 1,
        "beat": 1.0,
    }

    assert tl["tempo_map"][0]["bpm"] == 120.0
    assert tl["time_signature_map"][0]["numerator"] == 4


def test_chord_three_simultaneous_notes(make_midi):
    tl = make_midi([tempo(120),
                    on(60), on(64), on(67),
                    off(60, time=960), off(64), off(67)])
    assert tl["meta"]["note_count"] == 3
    assert [n["pitch"] for n in tl["notes"]] == [60, 64, 67]
    for n in tl["notes"]:
        assert n["start_seconds"] == 0.0
        assert n["end_seconds_explicit"] == 1.0


def test_note_on_velocity_zero_is_note_off(make_midi):
    tl = make_midi([tempo(120),
                    on(60, vel=90),
                    Message("note_on", note=60, velocity=0, channel=0, time=480)])
    assert tl["meta"]["note_count"] == 1
    n = tl["notes"][0]
    assert n["velocity"] == 90  # velocity comes from the note_on
    assert n["duration_ticks_explicit"] == 480


def test_overlapping_same_pitch_pairs_fifo(make_midi):
    # Two C4 note_ons before any note_off: the first note_off closes the
    # FIRST (earliest) note_on.
    tl = make_midi([tempo(120),
                    on(60, vel=50),
                    on(60, vel=99, time=240),
                    off(60, time=240),   # tick 480
                    off(60, time=480)])  # tick 960
    assert tl["meta"]["note_count"] == 2
    first, second = tl["notes"]
    assert (first["velocity"], first["start_tick"], first["end_tick_explicit"]) == (50, 0, 480)
    assert (second["velocity"], second["start_tick"], second["end_tick_explicit"]) == (99, 240, 960)


def test_multiple_tracks_channels_instruments(make_midi):
    tl = make_midi(
        [tempo(100)],
        [MetaMessage("track_name", name="Melody", time=0),
         Message("program_change", program=40, channel=0, time=0),  # Violin
         on(72, ch=0), off(72, ch=0, time=480)],
        [MetaMessage("track_name", name="Bass", time=0),
         Message("program_change", program=42, channel=1, time=0),  # Cello
         on(48, ch=1), off(48, ch=1, time=960)],
    )
    assert tl["meta"]["track_count"] == 3
    melody = [n for n in tl["notes"] if n["track"] == 1][0]
    bass = [n for n in tl["notes"] if n["track"] == 2][0]
    assert melody["track_name"] == "Melody"
    assert melody["instrument"] == "Violin"
    assert melody["channel"] == 0
    assert bass["instrument"] == "Cello"
    assert bass["channel"] == 1
    assert tl["tracks"][1]["name"] == "Melody"


def test_tempo_change_affects_seconds(make_midi):
    # Quarter at 120 BPM (0.5s), then tempo -> 60 BPM, quarter (1.0s).
    tl = make_midi([tempo(120),
                    on(60), off(60, time=480),
                    tempo(60),
                    on(62), off(62, time=480)])
    n1, n2 = tl["notes"]
    assert n1["duration_seconds_explicit"] == 0.5
    assert n2["start_seconds"] == 0.5
    assert n2["duration_seconds_explicit"] == 1.0
    assert len(tl["tempo_map"]) == 2
    assert tl["tempo_map"][1]["bpm"] == 60.0


def test_note_spanning_tempo_change(make_midi):
    # Note held across a tempo change: first 480 ticks at 120 BPM (0.5s),
    # next 480 ticks at 60 BPM (1.0s) -> total 1.5s.
    tl = make_midi([tempo(120),
                    on(60),
                    tempo(60, time=480),
                    off(60, time=480)])
    n = tl["notes"][0]
    assert n["duration_ticks_explicit"] == 960
    assert n["duration_seconds_explicit"] == pytest.approx(1.5)


def test_time_signature_bar_beat(make_midi):
    # 3/4 time: bar length = 3 * 480 = 1440 ticks.
    tl = make_midi([tempo(120), timesig(3, 4),
                    on(60), off(60, time=480),          # bar 1 beat 1
                    on(62, time=960), off(62, time=480),  # tick 1440 = bar 2 beat 1
                    on(64, time=240), off(64, time=240)])  # tick 2160 = bar 2 beat 2.5
    n1, n2, n3 = tl["notes"]
    assert (n1["bar"], n1["beat"]) == (1, 1.0)
    assert (n2["bar"], n2["beat"]) == (2, 1.0)
    assert (n3["bar"], n3["beat"]) == (2, 2.5)


def test_sustain_pedal_extends_sounding_duration(make_midi):
    # Pedal down before the note, key released at 240, pedal up at 960.
    tl = make_midi([tempo(120),
                    cc64(127),
                    on(60),
                    off(60, time=240),
                    cc64(0, time=720)])  # absolute tick 960
    n = tl["notes"][0]
    assert n["sustained"] is True
    assert n["end_tick_explicit"] == 240
    assert n["end_tick_sounding"] == 960
    assert n["duration_seconds_explicit"] == 0.25
    assert n["duration_seconds_sounding"] == 1.0
    assert tl["meta"]["has_sustain_data"] is True
    downs = [e for e in tl["sustain_events"] if e["pedal_down"]]
    ups = [e for e in tl["sustain_events"] if not e["pedal_down"]]
    assert len(downs) == 1 and len(ups) == 1


def test_pedal_down_after_note_off_does_not_extend(make_midi):
    tl = make_midi([tempo(120),
                    on(60), off(60, time=240),
                    cc64(127, time=240),
                    cc64(0, time=480)])
    n = tl["notes"][0]
    assert n["sustained"] is False
    assert n["end_tick_sounding"] == n["end_tick_explicit"] == 240


def test_pedal_never_released_sustains_to_end_of_file(make_midi):
    tl = make_midi([tempo(120),
                    cc64(127),
                    on(60), off(60, time=240),
                    on(72, time=720), off(72, time=480)])  # file ends at 1440
    n = tl["notes"][0]
    assert n["sustained"] is True
    assert n["end_tick_sounding"] == 1440


def test_pedal_half_values_threshold(make_midi):
    # 63 is up, 64 is down (boundary check).
    tl = make_midi([tempo(120),
                    cc64(64),
                    on(60), off(60, time=240),
                    cc64(63, time=240)])  # up at 480
    n = tl["notes"][0]
    assert n["sustained"] is True
    assert n["end_tick_sounding"] == 480


def test_no_pedal_data_marks_sustain_absent(make_midi):
    tl = make_midi([tempo(120), on(60), off(60, time=480)])
    assert tl["meta"]["has_sustain_data"] is False
    assert tl["sustain_events"] == []
    n = tl["notes"][0]
    assert n["duration_seconds_explicit"] == n["duration_seconds_sounding"]


def test_empty_and_control_only_tracks(make_midi):
    tl = make_midi(
        [tempo(120)],                      # meta only
        [cc64(127), cc64(0, time=960)],    # control only, no notes
        [on(60), off(60, time=480)],
    )
    assert tl["meta"]["note_count"] == 1
    assert tl["tracks"][1]["note_count"] == 0
    assert tl["meta"]["track_count"] == 3


def test_unterminated_note_closed_at_end(make_midi):
    tl = make_midi([tempo(120),
                    on(60),
                    on(62, time=480), off(62, time=480)])  # 60 never off; end=960
    n60 = [n for n in tl["notes"] if n["pitch"] == 60][0]
    assert n60["unterminated"] is True
    assert n60["end_tick_explicit"] == 960
    assert tl["meta"]["unterminated_notes"] == 1


def test_parsed_output_passes_schema_validation(make_midi):
    tl = make_midi([tempo(90), timesig(6, 8),
                    cc64(127), on(60), off(60, time=240), cc64(0, time=240),
                    on(65, time=100), off(65, time=200)])
    assert validate_timeline(tl) == []


def test_validation_catches_broken_timeline(make_midi):
    tl = make_midi([tempo(120), on(60), off(60, time=480)])
    tl["notes"][0]["pitch"] = 500
    assert any("pitch" in e for e in validate_timeline(tl))
    del tl["tempo_map"]
    assert any("tempo_map" in e for e in validate_timeline(tl))
