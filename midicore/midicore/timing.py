"""Renderer-agnostic timing/state query engine over a timeline dict.

This is the Python twin of studio/src/core/timing-engine.ts. Both consume
the same timeline JSON produced by midicore.parser. The design principle:
every rendered frame is derived from an explicit timestamp
(t = frame_number / fps), never from wall-clock playback.

All time arguments are seconds. Intervals are half-open [start, end):
a note that ends exactly at time t is NOT active at t.
"""

from __future__ import annotations

import math
from bisect import bisect_left, bisect_right


class TimelineQuery:
    def __init__(self, timeline: dict):
        self.timeline = timeline
        self.meta = timeline["meta"]
        # Notes are sorted by start_seconds by the parser; sort defensively
        # anyway since consumers may hand-build timelines.
        self.notes = sorted(timeline["notes"], key=lambda n: n["start_seconds"])
        self._starts = [n["start_seconds"] for n in self.notes]
        self._tempo = timeline.get("tempo_map", [])
        self._tempo_seconds = [t["seconds"] for t in self._tempo]
        self._timesig = timeline.get("time_signature_map", [])
        self._timesig_seconds = [t["seconds"] for t in self._timesig]
        self.ppq = self.meta["ticks_per_beat"]

    # -- global ------------------------------------------------------------

    @property
    def duration_seconds(self) -> float:
        return self.meta["duration_seconds"]

    # -- note-state queries --------------------------------------------------

    def notes_active_at(self, t: float) -> list[dict]:
        """Notes sounding at time t (including pedal-sustained tails)."""
        return self._scan(t, "end_seconds_sounding")

    def notes_held_at(self, t: float) -> list[dict]:
        """Notes whose key is physically held at time t."""
        return self._scan(t, "end_seconds_explicit")

    def notes_sustained_at(self, t: float) -> list[dict]:
        """Notes sounding at t ONLY because the sustain pedal is down
        (key already released)."""
        return [
            n for n in self._scan(t, "end_seconds_sounding")
            if n["end_seconds_explicit"] <= t
        ]

    def _scan(self, t: float, end_key: str) -> list[dict]:
        # Only notes with start <= t can be active; bisect gives that prefix.
        hi = bisect_right(self._starts, t)
        return [n for n in self.notes[:hi] if n[end_key] > t]

    def notes_starting_between(self, t0: float, t1: float) -> list[dict]:
        """Notes with t0 <= start < t1."""
        lo = bisect_left(self._starts, t0)
        hi = bisect_left(self._starts, t1)
        return self.notes[lo:hi]

    def notes_ending_between(self, t0: float, t1: float,
                             sounding: bool = True) -> list[dict]:
        """Notes with t0 <= end < t1 (sounding or explicit end)."""
        key = "end_seconds_sounding" if sounding else "end_seconds_explicit"
        return [n for n in self.notes if t0 <= n[key] < t1]

    # -- musical context -----------------------------------------------------

    def tempo_at(self, t: float) -> dict:
        i = max(bisect_right(self._tempo_seconds, t) - 1, 0)
        return self._tempo[i]

    def time_signature_at(self, t: float) -> dict:
        i = max(bisect_right(self._timesig_seconds, t) - 1, 0)
        return self._timesig[i]

    def seconds_to_tick(self, t: float) -> float:
        """Invert the tempo map (needed for bar/beat at arbitrary times)."""
        seg = self.tempo_at(t)
        return seg["tick"] + (t - seg["seconds"]) * 1_000_000 * self.ppq / seg["tempo_us_per_beat"]

    def bar_beat_at(self, t: float) -> tuple[int, float]:
        """(bar, beat) at time t; both 1-based, beat is fractional."""
        tick = self.seconds_to_tick(t)
        sig = self.time_signature_at(t)
        ticks_per_denom_beat = self.ppq * 4 / sig["denominator"]
        ticks_per_bar = sig["numerator"] * ticks_per_denom_beat
        ticks_in = tick - sig["tick"]
        bar = sig["bar"] + int(ticks_in // ticks_per_bar)
        beat = (ticks_in % ticks_per_bar) / ticks_per_denom_beat + 1
        return bar, beat

    # -- grouping --------------------------------------------------------------

    def notes_by_track(self) -> dict[int, list[dict]]:
        return self._group("track")

    def notes_by_channel(self) -> dict[int, list[dict]]:
        return self._group("channel")

    def notes_by_instrument(self) -> dict[str, list[dict]]:
        groups: dict[str, list[dict]] = {}
        for n in self.notes:
            groups.setdefault(n["instrument"] or "Unknown", []).append(n)
        return groups

    def _group(self, key: str) -> dict:
        groups: dict = {}
        for n in self.notes:
            groups.setdefault(n[key], []).append(n)
        return groups

    # -- frame math ---------------------------------------------------------

    @staticmethod
    def frame_time(frame_number: int, fps: float) -> float:
        """The timestamp a frame represents. THE core rendering contract."""
        return frame_number / fps

    def frame_count(self, fps: float, tail_seconds: float = 0.0) -> int:
        """Frames needed to cover the piece (plus an optional still tail)."""
        return math.ceil((self.duration_seconds + tail_seconds) * fps)
