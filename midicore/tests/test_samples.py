"""Every generated sample must parse cleanly and pass schema validation."""

import pytest

from midicore import samples
from midicore.parser import parse_midi
from midicore.schema import validate_timeline


@pytest.fixture(scope="module")
def sample_timelines(tmp_path_factory):
    out = tmp_path_factory.mktemp("samples")
    paths = samples.write_all(str(out))
    return {p.split("\\")[-1].replace(".mid", ""): parse_midi(p) for p in paths}


def test_all_samples_valid(sample_timelines):
    assert set(sample_timelines) == set(samples.GENERATORS)
    for name, tl in sample_timelines.items():
        assert validate_timeline(tl) == [], f"{name} failed validation"
        assert tl["meta"]["note_count"] > 0, f"{name} has no notes"


def test_prelude_has_sustain_and_extension(sample_timelines):
    tl = sample_timelines["prelude_c"]
    assert tl["meta"]["has_sustain_data"] is True
    sustained = [n for n in tl["notes"] if n["sustained"]]
    assert len(sustained) > 0
    # Bass notes are key-released quickly but pedal-carried much longer.
    bass = [n for n in sustained if n["pitch"] < 60]
    assert any(n["duration_seconds_sounding"] > 2 * n["duration_seconds_explicit"]
               for n in bass)


def test_tempo_change_sample(sample_timelines):
    tl = sample_timelines["tempo_change"]
    assert len(tl["tempo_map"]) == 2


def test_multitrack_sample(sample_timelines):
    tl = sample_timelines["multitrack"]
    channels = {n["channel"] for n in tl["notes"]}
    assert channels == {0, 1}
    instruments = {n["instrument"] for n in tl["notes"]}
    assert "Cello" in instruments
