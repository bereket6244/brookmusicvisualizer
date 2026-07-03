# Annotation format — `*.annotations.json`

Musical labels MIDI cannot carry: motifs, fugue subject/answer entries,
voices, sections, arbitrary tags. Annotations are a **sidecar JSON file**
next to a timeline; nothing in the core pipeline requires one. They exist
so future musical analysis (human or automated) has a place to plug into
visualizers *without* touching the parser.

## Where they live and how they load

- File name convention: `piece.timeline.json` → `piece.annotations.json`
  (same folder).
- **Studio**: picking a sample auto-loads a sidecar if present; any
  annotation file can also be loaded via the "Annotations" file input.
- **Renderer**: `renderer/render.js` auto-loads the sidecar next to
  `--timeline`, so renders see exactly what the preview saw.
- **Visualizers** receive them as `ctx.annotations`
  (an `AnnotationSet | undefined` — always handle the undefined case).

## Format

```json
{
  "format": "music-visualizer-annotations",
  "version": "1.0",
  "timeline": "samples/prelude_c.timeline.json",
  "labels": [
    {
      "id": "subject-entry-1",
      "type": "motif",
      "name": "Subject entry 1",
      "start_seconds": 0.0,
      "end_seconds": 3.5,
      "track": 1,
      "tags": ["subject", "voice-1"]
    },
    {
      "id": "halfway",
      "type": "marker",
      "name": "Halfway point",
      "start_seconds": 14.55
    }
  ]
}
```

Per label:

| field | required | meaning |
|---|---|---|
| `id` | yes | unique string |
| `type` | yes | free vocabulary; suggested: `motif`, `voice`, `section`, `phrase`, `marker`, `custom` |
| `name` | yes | display name |
| `start_seconds` | yes | label start (timeline seconds) |
| `end_seconds` | no | omit for instant markers |
| `track` / `channel` | no | scope the label to one track/channel |
| `note_ids` | no | timeline note `id`s the label points at |
| `tags` | no | string tags (`"subject"`, `"voice-2"`, …) |
| `data` | no | free-form object for future tooling |

Ranges are **half-open `[start, end)`**, matching note semantics.

## Querying from a visualizer

```ts
const anns = ctx.annotations;             // AnnotationSet | undefined
anns?.labelsAt(t)                          // active at time t
anns?.labelsOverlapping(t0, t1)
anns?.labelsOfType("motif")
anns?.labelsWithTag("subject")
anns?.labelsForTrack(2)
anns?.labelsForNote(noteId)
anns?.get("subject-entry-1")
```

Implementation + validation: `studio/src/core/annotations.ts`
(`parseAnnotations` throws readable errors). Working example file:
`samples/prelude_c.annotations.json`.

## What this is not

There is **no automatic analysis** — no fugue detection, no voice
separation. The format is deliberately simple so that a human with a score
can label a piece in minutes, and so that a future analysis tool has an
output target. See
[CREATIVE_WORKFLOW.md](CREATIVE_WORKFLOW.md) for when to reach for
annotations instead of MIDI data.
