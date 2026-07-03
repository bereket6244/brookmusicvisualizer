"""Optional flattened exports (CSV / JSONL) of the note list.

These are convenience exports for spreadsheet/pandas analysis. The
timeline JSON remains the primary interchange format; these files carry
only the flat note table, not tempo/time-signature/track context.
"""

from __future__ import annotations

import csv
import json

NOTE_COLUMNS = [
    "id", "pitch", "name", "note_name", "octave", "velocity",
    "track", "track_name", "channel", "program", "instrument",
    "start_tick", "end_tick_explicit", "end_tick_sounding",
    "duration_ticks_explicit", "duration_ticks_sounding",
    "start_seconds", "end_seconds_explicit", "end_seconds_sounding",
    "duration_seconds_explicit", "duration_seconds_sounding",
    "sustained", "bar", "beat",
]


def notes_to_csv(timeline: dict, path: str) -> None:
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=NOTE_COLUMNS, extrasaction="ignore")
        writer.writeheader()
        for note in timeline["notes"]:
            writer.writerow(note)


def notes_to_jsonl(timeline: dict, path: str) -> None:
    with open(path, "w", encoding="utf-8") as f:
        for note in timeline["notes"]:
            f.write(json.dumps(note) + "\n")
