"""TimelineQuery (timing engine) tests, including frame-timestamp math."""

import pytest

from midicore.timing import TimelineQuery

from conftest import cc64, off, on, tempo, timesig


@pytest.fixture
def engine(make_midi):
    # Layout at 120 BPM (480 ticks = 0.5s):
    #   C4: key 0.0 -> 0.25s, pedal sustains sound to 1.0s
    #   E4: 0.5 -> 1.5s plain
    #   G4: 1.0 -> 1.25s plain
    tl = make_midi([tempo(120), timesig(4, 4),
                    cc64(127),
                    on(60),                       # tick 0     (0.0s)
                    off(60, time=240),            # tick 240   (0.25s)
                    on(64, time=240),             # tick 480   (0.5s)
                    cc64(0, time=480),            # tick 960   (1.0s)  pedal up
                    on(67, time=0),               # tick 960   (1.0s)
                    off(67, time=240),            # tick 1200  (1.25s)
                    off(64, time=240)])           # tick 1440  (1.5s)
    return TimelineQuery(tl)


def names(notes):
    return sorted(n["name"] for n in notes)


def test_duration(engine):
    assert engine.duration_seconds == 1.5


def test_active_includes_sustained_tail(engine):
    # At 0.5s: C4 key was released at 0.25s but the pedal is down until 1.0s,
    # E4 just started.
    assert names(engine.notes_active_at(0.5)) == ["C4", "E4"]
    # Intervals are half-open: at exactly 1.0s C4 has stopped, G4 starts.
    assert names(engine.notes_active_at(1.0)) == ["E4", "G4"]


def test_held_vs_sustained(engine):
    assert names(engine.notes_held_at(0.1)) == ["C4"]
    assert names(engine.notes_held_at(0.5)) == ["E4"]      # C4 key released
    assert names(engine.notes_sustained_at(0.5)) == ["C4"]  # pedal-only
    assert names(engine.notes_sustained_at(0.1)) == []      # still held


def test_starting_and_ending_between(engine):
    assert names(engine.notes_starting_between(0.0, 0.6)) == ["C4", "E4"]
    assert names(engine.notes_starting_between(0.5, 0.5)) == []
    assert names(engine.notes_starting_between(0.5, 1.1)) == ["E4", "G4"]
    # C4 sounding end is 1.0s; explicit end is 0.25s.
    assert names(engine.notes_ending_between(0.9, 1.1, sounding=True)) == ["C4"]
    assert names(engine.notes_ending_between(0.2, 0.3, sounding=False)) == ["C4"]


def test_tempo_and_bar_beat(engine):
    assert engine.tempo_at(0.7)["bpm"] == 120.0
    bar, beat = engine.bar_beat_at(0.0)
    assert (bar, beat) == (1, 1.0)
    bar, beat = engine.bar_beat_at(1.0)  # 2 quarter notes in = beat 3
    assert bar == 1
    assert beat == pytest.approx(3.0)


def test_grouping(make_midi):
    tl = make_midi(
        [tempo(120)],
        [on(60, ch=0), off(60, ch=0, time=480)],
        [on(48, ch=1), off(48, ch=1, time=480)],
    )
    q = TimelineQuery(tl)
    assert set(q.notes_by_track()) == {1, 2}
    assert set(q.notes_by_channel()) == {0, 1}
    assert len(q.notes_by_instrument()["Unknown"]) == 2  # no program_change sent


def test_frame_math(engine):
    assert TimelineQuery.frame_time(0, 30) == 0.0
    assert TimelineQuery.frame_time(30, 30) == 1.0
    assert TimelineQuery.frame_time(45, 30) == 1.5
    assert TimelineQuery.frame_time(1, 60) == pytest.approx(1 / 60)
    # 1.5s piece at 30 fps -> 45 frames; +1.0s tail -> 75.
    assert engine.frame_count(30) == 45
    assert engine.frame_count(30, tail_seconds=1.0) == 75
