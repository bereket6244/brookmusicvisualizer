"""MIDI file -> normalized timeline JSON.

This module is the heart of the project. It converts a raw MIDI file
(delta-time event soup) into a flat, absolute-time, human-readable
structure that visualizers and analysis tools can consume without
knowing anything about MIDI internals.

Key concepts handled here (see docs/GLOSSARY.md for plain-language
explanations):

* Delta ticks -> absolute ticks (cumulative sum per track).
* Tempo map: `set_tempo` meta events change how many seconds one tick
  lasts, so tick->seconds conversion must walk tempo segments.
* Note pairing: a sounding note is the span between a `note_on` and the
  matching `note_off` (or `note_on` with velocity 0 — the very common
  "running status" shorthand for note-off).
* Sustain pedal (CC64): while the pedal is down (value >= 64), notes
  whose key is released keep sounding until the pedal comes up. We keep
  BOTH durations: "explicit" (key physically held) and "sounding"
  (after pedal extension), so visualizers can distinguish them.
"""

from __future__ import annotations

import os
import time as _time
from bisect import bisect_right
from dataclasses import dataclass, field

import mido

from . import notes as notedata

DEFAULT_TEMPO_US = 500_000  # MIDI default: 120 BPM (microseconds per quarter note)


class SMPTETimebaseError(ValueError):
    """Raised for SMPTE-timebase MIDI files (division high bit set).

    Almost all MIDI files use PPQ (musical) timing. SMPTE division encodes
    wall-clock frames-per-second instead; our tempo-map math would silently
    produce wrong seconds for such files, so we refuse loudly instead of
    parsing them incorrectly.
    """


def _reject_smpte_timebase(path: str) -> None:
    """Inspect the raw MThd header: bytes 12-13 are the division field; a
    set high bit means SMPTE timing. Checked before mido parses so the
    error is ours and explicit (mido's own handling of SMPTE is spotty)."""
    with open(path, "rb") as f:
        header = f.read(14)
    if len(header) >= 14 and header[:4] == b"MThd":
        division = int.from_bytes(header[12:14], "big")
        if division & 0x8000:
            fps = 256 - (division >> 8)  # two's complement of the high byte
            raise SMPTETimebaseError(
                f"{path}: SMPTE-timebase MIDI files ({fps} fps division) are "
                "not supported. Re-export the file with musical (PPQ) timing "
                "— nearly every DAW/notation tool does this by default."
            )


# --------------------------------------------------------------------------
# Tempo map
# --------------------------------------------------------------------------

class TempoMap:
    """Piecewise-constant tempo. Converts absolute ticks to seconds.

    seconds(tick) = seg.seconds + (tick - seg.tick) * seg.tempo / (ppq * 1e6)

    where `seg` is the last tempo change at or before `tick`.
    """

    def __init__(self, events: list[tuple[int, int]], ticks_per_beat: int):
        self.ppq = ticks_per_beat
        # Deduplicate by tick (last one at a tick wins) and force an entry
        # at tick 0 so lookup never falls off the front.
        by_tick: dict[int, int] = {}
        for tick, tempo in sorted(events):
            by_tick[tick] = tempo
        if 0 not in by_tick:
            by_tick[0] = DEFAULT_TEMPO_US
        ticks = sorted(by_tick)
        self.segments: list[tuple[int, float, int]] = []  # (tick, seconds, tempo_us)
        seconds = 0.0
        prev_tick, prev_tempo = ticks[0], by_tick[ticks[0]]
        # tick 0 entry may itself be a change; seconds at tick 0 is 0.
        self.segments.append((0, 0.0, by_tick[0] if ticks[0] == 0 else DEFAULT_TEMPO_US))
        for tick in ticks:
            if tick == 0:
                prev_tick, prev_tempo = 0, by_tick[0]
                continue
            seconds += (tick - prev_tick) * prev_tempo / (self.ppq * 1_000_000)
            self.segments.append((tick, seconds, by_tick[tick]))
            prev_tick, prev_tempo = tick, by_tick[tick]
        self._seg_ticks = [s[0] for s in self.segments]

    def tick_to_seconds(self, tick: int) -> float:
        i = bisect_right(self._seg_ticks, tick) - 1
        seg_tick, seg_seconds, tempo = self.segments[i]
        return seg_seconds + (tick - seg_tick) * tempo / (self.ppq * 1_000_000)

    def tempo_at_tick(self, tick: int) -> int:
        i = bisect_right(self._seg_ticks, tick) - 1
        return self.segments[i][2]

    def as_json(self) -> list[dict]:
        return [
            {
                "tick": tick,
                "seconds": round(seconds, 6),
                "tempo_us_per_beat": tempo,
                "bpm": round(60_000_000 / tempo, 4),
            }
            for tick, seconds, tempo in self.segments
        ]


# --------------------------------------------------------------------------
# Time signature map (for bar/beat positions)
# --------------------------------------------------------------------------

class TimeSignatureMap:
    def __init__(self, events: list[tuple[int, int, int]], ticks_per_beat: int,
                 tempo_map: TempoMap):
        self.ppq = ticks_per_beat
        by_tick: dict[int, tuple[int, int]] = {}
        for tick, num, den in sorted(events):
            by_tick[tick] = (num, den)
        if 0 not in by_tick:
            by_tick[0] = (4, 4)  # MIDI default
        # Each segment: (tick, numerator, denominator, first_bar_number)
        # first_bar_number is the 1-based bar number in effect at seg start.
        self.segments: list[dict] = []
        bar = 1
        prev = None
        for tick in sorted(by_tick):
            num, den = by_tick[tick]
            if prev is not None:
                # Advance bar count through the previous segment. A signature
                # change mid-bar starts a new bar (standard notation behavior).
                elapsed = tick - prev["tick"]
                bars = elapsed / prev["ticks_per_bar"]
                bar = prev["bar"] + int(bars) + (1 if bars % 1 > 1e-9 else 0)
            ticks_per_denom_beat = ticks_per_beat * 4 / den
            seg = {
                "tick": tick,
                "seconds": round(tempo_map.tick_to_seconds(tick), 6),
                "numerator": num,
                "denominator": den,
                "bar": bar,
                "ticks_per_bar": num * ticks_per_denom_beat,
                "ticks_per_denom_beat": ticks_per_denom_beat,
            }
            self.segments.append(seg)
            prev = seg
        self._seg_ticks = [s["tick"] for s in self.segments]

    def bar_beat_at_tick(self, tick: int) -> tuple[int, float]:
        """1-based bar number and 1-based (float) beat within the bar."""
        i = bisect_right(self._seg_ticks, tick) - 1
        seg = self.segments[i]
        ticks_in = tick - seg["tick"]
        bar = seg["bar"] + int(ticks_in // seg["ticks_per_bar"])
        rem = ticks_in % seg["ticks_per_bar"]
        beat = rem / seg["ticks_per_denom_beat"] + 1
        return bar, round(beat, 6)

    def as_json(self) -> list[dict]:
        return [
            {k: s[k] for k in ("tick", "seconds", "numerator", "denominator", "bar")}
            for s in self.segments
        ]


# --------------------------------------------------------------------------
# Raw event collection
# --------------------------------------------------------------------------

@dataclass
class _RawTrack:
    index: int
    name: str = ""
    channels: set = field(default_factory=set)
    note_event_count: int = 0


def parse_midi(path: str) -> dict:
    """Parse a MIDI file into the normalized timeline dict (see docs/SCHEMA.md)."""
    _reject_smpte_timebase(path)
    mid = mido.MidiFile(path)
    ppq = mid.ticks_per_beat

    tempo_events: list[tuple[int, int]] = []
    timesig_events: list[tuple[int, int, int]] = []
    program_events: list[tuple[int, int, int]] = []      # (tick, channel, program)
    sustain_events: list[dict] = []                       # raw CC64 records
    note_ons: list[dict] = []                             # temp per-note records
    raw_tracks: list[_RawTrack] = []
    max_tick = 0

    # Open notes keyed by (track, channel, pitch). FIFO list so overlapping
    # notes of the same pitch pair note_off with the EARLIEST open note_on
    # (the conventional interpretation).
    open_notes: dict[tuple[int, int, int], list[dict]] = {}
    finished: list[dict] = []

    for t_idx, track in enumerate(mid.tracks):
        info = _RawTrack(index=t_idx)
        abs_tick = 0
        for msg in track:
            abs_tick += msg.time  # msg.time is DELTA ticks since previous event
            if msg.type == "set_tempo":
                tempo_events.append((abs_tick, msg.tempo))
            elif msg.type == "time_signature":
                timesig_events.append((abs_tick, msg.numerator, msg.denominator))
            elif msg.type == "track_name" and not info.name:
                info.name = msg.name
            elif msg.type == "program_change":
                program_events.append((abs_tick, msg.channel, msg.program))
                info.channels.add(msg.channel)
            elif msg.type == "control_change" and msg.control == 64:
                sustain_events.append({
                    "tick": abs_tick, "channel": msg.channel,
                    "value": msg.value, "track": t_idx,
                })
                info.channels.add(msg.channel)
            elif msg.type == "note_on" and msg.velocity > 0:
                info.channels.add(msg.channel)
                info.note_event_count += 1
                rec = {
                    "pitch": msg.note, "velocity": msg.velocity,
                    "channel": msg.channel, "track": t_idx,
                    "start_tick": abs_tick, "end_tick": None,
                }
                open_notes.setdefault((t_idx, msg.channel, msg.note), []).append(rec)
                note_ons.append(rec)
            elif msg.type == "note_off" or (msg.type == "note_on" and msg.velocity == 0):
                # note_on with velocity 0 is the standard shorthand for note_off.
                key = (t_idx, msg.channel, msg.note)
                stack = open_notes.get(key)
                if stack:
                    rec = stack.pop(0)  # FIFO: close the earliest open note
                    rec["end_tick"] = abs_tick
                    finished.append(rec)
                # A note_off with no matching note_on is silently ignored.
        max_tick = max(max_tick, abs_tick)
        raw_tracks.append(info)

    # Close any notes that never received a note_off (malformed files):
    # they end at the last event of the file.
    unterminated = 0
    for stack in open_notes.values():
        for rec in stack:
            rec["end_tick"] = max_tick
            rec["unterminated"] = True
            finished.append(rec)
            unterminated += 1

    tempo_map = TempoMap(tempo_events, ppq)
    timesig_map = TimeSignatureMap(timesig_events, ppq, tempo_map)

    # ----------------------------------------------------------------------
    # Sustain pedal intervals, per channel.
    # CC64 value >= 64 means "pedal down", < 64 means "pedal up".
    # Events from ALL tracks are merged per channel, because the pedal
    # affects the channel, not the track that carried the message.
    # ----------------------------------------------------------------------
    pedal_intervals: dict[int, list[tuple[int, int]]] = {}
    by_channel: dict[int, list[dict]] = {}
    for ev in sorted(sustain_events, key=lambda e: e["tick"]):
        by_channel.setdefault(ev["channel"], []).append(ev)
    for channel, evs in by_channel.items():
        intervals = []
        down_at: int | None = None
        for ev in evs:
            if ev["value"] >= 64 and down_at is None:
                down_at = ev["tick"]
            elif ev["value"] < 64 and down_at is not None:
                intervals.append((down_at, ev["tick"]))
                down_at = None
        if down_at is not None:
            # Pedal held to the end of the file: sustain until the last event.
            intervals.append((down_at, max_tick))
        pedal_intervals[channel] = intervals

    def sustain_release_after(channel: int, tick: int) -> int | None:
        """If the pedal on `channel` is down at `tick`, return the tick where
        it is released; otherwise None. Interval is half-open [down, up)."""
        for down, up in pedal_intervals.get(channel, ()):
            if down <= tick < up:
                return up
        return None

    # Program (instrument) lookup per channel: last program_change at or
    # before a given tick wins. Default GM program is 0 (Acoustic Grand Piano)
    # but we only report a program if the file actually set one.
    prog_by_channel: dict[int, list[tuple[int, int]]] = {}
    for tick, channel, program in sorted(program_events):
        prog_by_channel.setdefault(channel, []).append((tick, program))

    def program_at(channel: int, tick: int) -> int | None:
        lst = prog_by_channel.get(channel)
        if not lst:
            return None
        ticks = [t for t, _ in lst]
        i = bisect_right(ticks, tick) - 1
        return lst[i][1] if i >= 0 else None

    # ----------------------------------------------------------------------
    # Sustain extension + re-strike realism
    # ----------------------------------------------------------------------
    # Pass 1: extend every note to the pedal release on its channel.
    for rec in finished:
        release = sustain_release_after(rec["channel"], rec["end_tick"])
        # Only extend if the pedal release is actually later than the key
        # release; a pedal that comes up at the same tick changes nothing.
        rec["sustained"] = release is not None and release > rec["end_tick"]
        rec["end_tick_sounding"] = release if rec["sustained"] else rec["end_tick"]

    # Pass 2: re-striking a pitch cuts the pedal tail of the previous note
    # of that pitch. On a real piano the hammer re-uses the string, so the
    # old vibration is replaced at the moment of the new attack. Grouped by
    # (channel, pitch) — the pedal and the string are per channel, not per
    # track. Only the PEDAL tail is cut (start > end_tick): two genuinely
    # overlapping held notes of the same pitch are left to FIFO pairing.
    by_pitch: dict[tuple[int, int], list[dict]] = {}
    for rec in finished:
        by_pitch.setdefault((rec["channel"], rec["pitch"]), []).append(rec)
    for recs in by_pitch.values():
        recs.sort(key=lambda r: r["start_tick"])
        for i, rec in enumerate(recs):
            if not rec["sustained"]:
                continue
            for nxt in recs[i + 1:]:
                if rec["end_tick"] < nxt["start_tick"] < rec["end_tick_sounding"]:
                    rec["end_tick_sounding"] = nxt["start_tick"]
                    rec["restruck"] = True
                    # If the cut lands exactly at the key release the pedal
                    # effectively added nothing.
                    if rec["end_tick_sounding"] <= rec["end_tick"]:
                        rec["sustained"] = False
                    break

    # ----------------------------------------------------------------------
    # Build normalized note records
    # ----------------------------------------------------------------------
    finished.sort(key=lambda r: (r["start_tick"], r["pitch"], r["track"]))
    notes_json = []
    for i, rec in enumerate(finished):
        start_tick = rec["start_tick"]
        end_tick_explicit = rec["end_tick"]
        sustained = rec["sustained"]
        end_tick_sounding = rec["end_tick_sounding"]

        start_s = tempo_map.tick_to_seconds(start_tick)
        end_exp_s = tempo_map.tick_to_seconds(end_tick_explicit)
        end_snd_s = tempo_map.tick_to_seconds(end_tick_sounding)
        name, octave = notedata.pitch_to_name_octave(rec["pitch"])
        program = program_at(rec["channel"], start_tick)
        bar, beat = timesig_map.bar_beat_at_tick(start_tick)

        note = {
            "id": i,
            "pitch": rec["pitch"],
            "name": f"{name}{octave}",
            "note_name": name,
            "octave": octave,
            "velocity": rec["velocity"],
            "track": rec["track"],
            "track_name": raw_tracks[rec["track"]].name,
            "channel": rec["channel"],
            "program": program,
            "instrument": notedata.program_name(program),
            "start_tick": start_tick,
            "end_tick_explicit": end_tick_explicit,
            "end_tick_sounding": end_tick_sounding,
            "duration_ticks_explicit": end_tick_explicit - start_tick,
            "duration_ticks_sounding": end_tick_sounding - start_tick,
            "start_seconds": round(start_s, 6),
            "end_seconds_explicit": round(end_exp_s, 6),
            "end_seconds_sounding": round(end_snd_s, 6),
            "duration_seconds_explicit": round(end_exp_s - start_s, 6),
            "duration_seconds_sounding": round(end_snd_s - start_s, 6),
            "sustained": sustained,
            "bar": bar,
            "beat": beat,
        }
        if rec.get("unterminated"):
            note["unterminated"] = True
        if rec.get("restruck"):
            # This note's pedal tail was cut short by a re-strike of the
            # same pitch (see pass 2 above).
            note["restruck"] = True
        notes_json.append(note)

    # Track summaries
    tracks_json = []
    for info in raw_tracks:
        programs = []
        for ch in sorted(info.channels):
            p = program_at(ch, max_tick)
            programs.append({
                "channel": ch,
                "program": p,
                "name": notedata.program_name(p),
            })
        tracks_json.append({
            "index": info.index,
            "name": info.name,
            "channels": sorted(info.channels),
            "programs": programs,
            "note_count": info.note_event_count,
        })

    sustain_json = [
        {
            "tick": ev["tick"],
            "seconds": round(tempo_map.tick_to_seconds(ev["tick"]), 6),
            "channel": ev["channel"],
            "value": ev["value"],
            "pedal_down": ev["value"] >= 64,
            "track": ev["track"],
        }
        for ev in sorted(sustain_events, key=lambda e: (e["tick"], e["channel"]))
    ]

    # Duration covers both the last sounding note and any trailing events.
    last_note_end = max((n["end_seconds_sounding"] for n in notes_json), default=0.0)
    duration_seconds = max(last_note_end, tempo_map.tick_to_seconds(max_tick))

    return {
        "format": "midicore-timeline",
        # 1.1: added optional note field "restruck" (pedal tail cut by a
        # re-strike of the same pitch). Purely additive over 1.0.
        "format_version": "1.1",
        "meta": {
            "source_file": os.path.basename(path),
            "parsed_at": _time.strftime("%Y-%m-%dT%H:%M:%S"),
            "midi_format": mid.type,
            "ticks_per_beat": ppq,
            "duration_seconds": round(duration_seconds, 6),
            "duration_ticks": max_tick,
            "note_count": len(notes_json),
            "track_count": len(tracks_json),
            "has_sustain_data": len(sustain_json) > 0,
            "unterminated_notes": unterminated,
        },
        "tempo_map": tempo_map.as_json(),
        "time_signature_map": timesig_map.as_json(),
        "tracks": tracks_json,
        "sustain_events": sustain_json,
        "notes": notes_json,
    }
