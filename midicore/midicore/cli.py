"""Command-line interface: python -m midicore <command> ...

Commands mirror the studio's actions so everything is scriptable:
    parse     MIDI -> timeline JSON (+ optional CSV/JSONL exports)
    samples   generate demo/test MIDI files (+ parsed timelines)
    schema    print/write the JSON Schema for the timeline format
    validate  structurally validate a timeline JSON file
    info      human-readable summary of a timeline JSON file
"""

from __future__ import annotations

import argparse
import json
import os
import sys

from . import exports, samples
from .parser import parse_midi
from .schema import timeline_json_schema, validate_timeline
from .timing import TimelineQuery


def _cmd_parse(args) -> int:
    timeline = parse_midi(args.midi)
    out = args.output or os.path.splitext(args.midi)[0] + ".timeline.json"
    with open(out, "w", encoding="utf-8") as f:
        json.dump(timeline, f, indent=2 if args.pretty else None)
    print(f"wrote {out}  ({timeline['meta']['note_count']} notes, "
          f"{timeline['meta']['duration_seconds']:.2f}s)")
    base = os.path.splitext(out)[0]
    if args.csv:
        exports.notes_to_csv(timeline, base + ".notes.csv")
        print(f"wrote {base}.notes.csv")
    if args.jsonl:
        exports.notes_to_jsonl(timeline, base + ".notes.jsonl")
        print(f"wrote {base}.notes.jsonl")
    return 0


def _cmd_samples(args) -> int:
    paths = samples.write_all(args.out)
    for path in paths:
        timeline = parse_midi(path)
        json_path = os.path.splitext(path)[0] + ".timeline.json"
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(timeline, f, indent=2)
        print(f"wrote {path} + {os.path.basename(json_path)}")
    return 0


def _cmd_schema(args) -> int:
    schema = timeline_json_schema()
    text = json.dumps(schema, indent=2)
    if args.output:
        parent = os.path.dirname(args.output)
        if parent:
            os.makedirs(parent, exist_ok=True)
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(text + "\n")
        print(f"wrote {args.output}")
    else:
        print(text)
    return 0


def _cmd_validate(args) -> int:
    with open(args.timeline, encoding="utf-8") as f:
        timeline = json.load(f)
    problems = validate_timeline(timeline)
    if problems:
        for p in problems:
            print(f"INVALID: {p}")
        return 1
    print("valid")
    return 0


def _cmd_info(args) -> int:
    with open(args.timeline, encoding="utf-8") as f:
        timeline = json.load(f)
    q = TimelineQuery(timeline)
    meta = timeline["meta"]
    print(f"file:      {meta['source_file']}")
    print(f"duration:  {meta['duration_seconds']:.2f}s "
          f"({meta['duration_ticks']} ticks, PPQ {meta['ticks_per_beat']})")
    print(f"notes:     {meta['note_count']}")
    print(f"tracks:    {meta['track_count']}")
    print(f"sustain:   {'yes' if meta['has_sustain_data'] else 'no'}")
    print(f"tempo:     {timeline['tempo_map'][0]['bpm']:.1f} BPM"
          + (" (changes)" if len(timeline["tempo_map"]) > 1 else ""))
    sig = timeline["time_signature_map"][0]
    print(f"time sig:  {sig['numerator']}/{sig['denominator']}")
    for track in timeline["tracks"]:
        insts = ", ".join(p["name"] or "?" for p in track["programs"]) or "-"
        print(f"  track {track['index']}: {track['name'] or '(unnamed)'} "
              f"notes={track['note_count']} instruments={insts}")
    if args.at is not None:
        active = q.notes_active_at(args.at)
        held = q.notes_held_at(args.at)
        sus = q.notes_sustained_at(args.at)
        bar, beat = q.bar_beat_at(args.at)
        print(f"\nat t={args.at}s (bar {bar}, beat {beat:.2f}):")
        print(f"  sounding:  {[n['name'] for n in active]}")
        print(f"  held:      {[n['name'] for n in held]}")
        print(f"  sustained: {[n['name'] for n in sus]}")
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="midicore",
                                     description=__doc__.split("\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("parse", help="parse a MIDI file to timeline JSON")
    p.add_argument("midi")
    p.add_argument("-o", "--output", help="output path (default: <midi>.timeline.json)")
    p.add_argument("--csv", action="store_true", help="also export flat notes CSV")
    p.add_argument("--jsonl", action="store_true", help="also export flat notes JSONL")
    p.add_argument("--pretty", action="store_true", help="indent the JSON output")
    p.set_defaults(func=_cmd_parse)

    p = sub.add_parser("samples", help="generate sample MIDI files + timelines")
    p.add_argument("--out", default="samples", help="output directory")
    p.set_defaults(func=_cmd_samples)

    p = sub.add_parser("schema", help="print the timeline JSON Schema")
    p.add_argument("-o", "--output")
    p.set_defaults(func=_cmd_schema)

    p = sub.add_parser("validate", help="validate a timeline JSON file")
    p.add_argument("timeline")
    p.set_defaults(func=_cmd_validate)

    p = sub.add_parser("info", help="summarize a timeline JSON file")
    p.add_argument("timeline")
    p.add_argument("--at", type=float, help="also show musical state at time t")
    p.set_defaults(func=_cmd_info)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
