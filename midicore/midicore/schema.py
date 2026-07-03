"""Timeline JSON schema (draft-07 style) and a lightweight validator.

The validator is intentionally dependency-free (no jsonschema package):
it checks the structural contract that visualizers and the timing engine
rely on. `validate_timeline` returns a list of problems; empty == valid.
"""

from __future__ import annotations

_NOTE_REQUIRED = {
    "id": int, "pitch": int, "name": str, "note_name": str, "octave": int,
    "velocity": int, "track": int, "channel": int,
    "start_tick": int, "end_tick_explicit": int, "end_tick_sounding": int,
    "duration_ticks_explicit": int, "duration_ticks_sounding": int,
    "start_seconds": (int, float), "end_seconds_explicit": (int, float),
    "end_seconds_sounding": (int, float),
    "duration_seconds_explicit": (int, float),
    "duration_seconds_sounding": (int, float),
    "sustained": bool, "bar": int, "beat": (int, float),
}

_META_REQUIRED = {
    "source_file": str, "ticks_per_beat": int,
    "duration_seconds": (int, float), "duration_ticks": int,
    "note_count": int, "track_count": int, "has_sustain_data": bool,
}


def validate_timeline(timeline: dict) -> list[str]:
    errors: list[str] = []

    def check(cond: bool, msg: str):
        if not cond:
            errors.append(msg)

    check(isinstance(timeline, dict), "timeline must be an object")
    if not isinstance(timeline, dict):
        return errors
    check(timeline.get("format") == "midicore-timeline",
          "format must be 'midicore-timeline'")
    for key in ("meta", "tempo_map", "time_signature_map", "tracks",
                "sustain_events", "notes"):
        check(key in timeline, f"missing top-level key: {key}")
    if errors:
        return errors

    meta = timeline["meta"]
    for key, typ in _META_REQUIRED.items():
        check(key in meta, f"meta.{key} missing")
        if key in meta:
            check(isinstance(meta[key], typ), f"meta.{key} has wrong type")

    for i, entry in enumerate(timeline["tempo_map"]):
        for key in ("tick", "seconds", "tempo_us_per_beat", "bpm"):
            check(key in entry, f"tempo_map[{i}].{key} missing")

    for i, entry in enumerate(timeline["time_signature_map"]):
        for key in ("tick", "seconds", "numerator", "denominator", "bar"):
            check(key in entry, f"time_signature_map[{i}].{key} missing")

    for i, note in enumerate(timeline["notes"]):
        for key, typ in _NOTE_REQUIRED.items():
            if key not in note:
                errors.append(f"notes[{i}].{key} missing")
            elif not isinstance(note[key], typ):
                errors.append(f"notes[{i}].{key} has wrong type")
        if errors:
            break  # one bad note is enough signal; avoid error spam
        check(note["end_tick_explicit"] >= note["start_tick"],
              f"notes[{i}] explicit end before start")
        check(note["end_tick_sounding"] >= note["end_tick_explicit"],
              f"notes[{i}] sounding end before explicit end")
        check(0 <= note["pitch"] <= 127, f"notes[{i}].pitch out of range")
        check(0 <= note["velocity"] <= 127, f"notes[{i}].velocity out of range")
        check(0 <= note["channel"] <= 15, f"notes[{i}].channel out of range")

    return errors


def timeline_json_schema() -> dict:
    """A JSON-Schema (draft-07) description of the timeline format,
    suitable for external tooling. Field meanings live in docs/SCHEMA.md."""

    def num():
        return {"type": "number"}

    def integer(lo=None, hi=None):
        s = {"type": "integer"}
        if lo is not None:
            s["minimum"] = lo
        if hi is not None:
            s["maximum"] = hi
        return s

    note_props = {
        "id": integer(0),
        "pitch": integer(0, 127),
        "name": {"type": "string", "description": "e.g. 'C4' (middle C = 60)"},
        "note_name": {"type": "string"},
        "octave": {"type": "integer"},
        "velocity": integer(0, 127),
        "track": integer(0),
        "track_name": {"type": "string"},
        "channel": integer(0, 15),
        "program": {"type": ["integer", "null"]},
        "instrument": {"type": ["string", "null"]},
        "start_tick": integer(0),
        "end_tick_explicit": integer(0),
        "end_tick_sounding": integer(0),
        "duration_ticks_explicit": integer(0),
        "duration_ticks_sounding": integer(0),
        "start_seconds": num(),
        "end_seconds_explicit": num(),
        "end_seconds_sounding": num(),
        "duration_seconds_explicit": num(),
        "duration_seconds_sounding": num(),
        "sustained": {"type": "boolean"},
        "bar": integer(1),
        "beat": num(),
        "unterminated": {"type": "boolean"},
    }

    return {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "title": "midicore timeline",
        "description": "Normalized musical timeline extracted from a MIDI "
                       "file. See docs/SCHEMA.md for plain-language field "
                       "documentation.",
        "type": "object",
        "required": ["format", "format_version", "meta", "tempo_map",
                     "time_signature_map", "tracks", "sustain_events", "notes"],
        "properties": {
            "format": {"const": "midicore-timeline"},
            "format_version": {"type": "string"},
            "meta": {
                "type": "object",
                "required": list(_META_REQUIRED),
                "properties": {
                    "source_file": {"type": "string"},
                    "parsed_at": {"type": "string"},
                    "midi_format": {"type": "integer"},
                    "ticks_per_beat": integer(1),
                    "duration_seconds": num(),
                    "duration_ticks": integer(0),
                    "note_count": integer(0),
                    "track_count": integer(0),
                    "has_sustain_data": {"type": "boolean"},
                    "unterminated_notes": integer(0),
                },
            },
            "tempo_map": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["tick", "seconds", "tempo_us_per_beat", "bpm"],
                    "properties": {
                        "tick": integer(0), "seconds": num(),
                        "tempo_us_per_beat": integer(1), "bpm": num(),
                    },
                },
            },
            "time_signature_map": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["tick", "seconds", "numerator",
                                 "denominator", "bar"],
                    "properties": {
                        "tick": integer(0), "seconds": num(),
                        "numerator": integer(1), "denominator": integer(1),
                        "bar": integer(1),
                    },
                },
            },
            "tracks": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["index", "name", "channels", "programs",
                                 "note_count"],
                },
            },
            "sustain_events": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["tick", "seconds", "channel", "value",
                                 "pedal_down", "track"],
                },
            },
            "notes": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": [k for k in note_props if k not in
                                 ("unterminated", "program", "instrument",
                                  "track_name")],
                    "properties": note_props,
                },
            },
        },
    }
