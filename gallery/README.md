# Gallery

A static, dependency-free page for showing finished renders and notes.
It is intentionally **isolated from the core system**: it does not parse
MIDI, run ffmpeg/Playwright, or touch the render pipeline. It only
displays files you put here.

## Adding an item

1. Render something: `npm run render -- --timeline samples/prelude_c.timeline.json`
2. Copy the MP4 (or a PNG still) from `output/renders/<job>/` into
   `gallery/media/` (this folder is gitignored — media stays local).
3. Add an entry to `manifest.json`:

```json
{ "type": "video", "tag": "final", "title": "Prelude in C",
  "src": "media/prelude_demo.mp4",
  "description": "Circular accumulator, 1080p30." }
```

`type` is `video`, `image`, or `note` (text-only card — useful for
visualizer descriptions or MIDI metadata summaries).

## Viewing

Browsers block `fetch` from `file://`, so serve the folder:

```powershell
npm run gallery     # http://localhost:8899
```

(or `python -m http.server 8899 --directory gallery`).
