"""midicore — reusable MIDI parsing and musical timing toolkit.

Public API:
    parse_midi(path)         -> normalized timeline dict (the project interchange format)
    TimelineQuery(timeline)  -> renderer-agnostic timing/state query engine
    validate_timeline(tl)    -> list of structural problems (empty list == valid)

The timeline JSON format is documented in docs/SCHEMA.md and by
`python -m midicore schema`.
"""

from .parser import parse_midi
from .timing import TimelineQuery
from .schema import validate_timeline, timeline_json_schema

FORMAT_VERSION = "1.0"

__all__ = [
    "parse_midi",
    "TimelineQuery",
    "validate_timeline",
    "timeline_json_schema",
    "FORMAT_VERSION",
]
