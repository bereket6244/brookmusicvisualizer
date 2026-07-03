# Creative Workflow — from visual idea to finished visualizer

This guide is about *process*: what to write down when you get an idea,
where to start in the code, and how to think about the mapping between
music and image. The technical interface reference lives in
[GUIDE.md](GUIDE.md); studio controls in [STUDIO.md](STUDIO.md).

---

## The five-step loop

Every visualizer in this project went (or should go) through the same loop:

```
1. define the MUSICAL UNIT   what one "thing" in the music is
2. define the VISUAL MAPPING what that thing becomes on screen
3. define the PARAMETERS     what you'll want to tweak later
4. implement                 params first, then create(), then renderAtTime(t)
5. test                      preview → scrub → inspect → preset → smoke render
```

Do steps 1–3 on paper (or in a comment block) *before* writing rendering
code. Ten minutes of mapping decisions saves hours of refactoring, because
the mapping decides your data structures.

---

## Step 1 — Define the musical unit

Ask: **when I imagine the finished video, what does one visual element
correspond to?** Common answers, and what the timeline gives you for each:

| Unit | What the timeline/timing engine provides | Effort |
|---|---|---|
| **note** | everything: pitch, velocity, both durations, track, channel, bar/beat (`engine.notes`, `notesActiveAt(t)`, …) | free |
| **chord / simultaneity** | derive from `notesStartingBetween(t, t+ε)` or group notes with equal `start_seconds` | small code |
| **bar / beat** | `barBeatAt(t)`, `timeSignatureAt(t)` — good for pulses, grids, camera moves | free |
| **track / channel / instrument** | `note.track`, `note.channel`, `note.instrument`, `notesByTrack()` — often maps to hands, staves, or orchestral parts | free |
| **density / texture** | count `notesActiveAt(t)` or notes per rolling window — great for global intensity, blur, glow | small code |
| **phrase** | NOT in MIDI. Approximate with rests (gaps between note ends and next starts) or annotate by hand | annotations |
| **voice** (fugue Voice A/B/C) | *sometimes* approximated by track/channel if the file was exported per-voice; otherwise not in MIDI | annotations |
| **motif / subject / answer** | NOT in MIDI at all — this is music analysis, not parsing | annotations |
| **tension / release** | not in MIDI; proxies: pitch height, density, velocity trends — or annotate | annotations |

**The honest rule:** MIDI knows *which keys were pressed, when, how hard,
on which track/channel, with which pedal*. Everything else — phrases,
voices, subjects, countersubjects, climaxes — is interpretation. When your
idea needs interpretation, use the [annotation system](ANNOTATIONS.md)
instead of trying to squeeze it out of the parser.

### Fugues and voices specifically

- Some MIDI exports put each fugue voice on its own **track** (notation
  software often does). Check with
  `midicore\.venv\Scripts\python -m midicore info piece.timeline.json` —
  if you see 3–5 named tracks for a 3–5 voice fugue, you're lucky: use
  `note.track` as the voice.
- Piano-recorded MIDI usually has **one track = both hands**, and voices
  cross freely. No algorithm in this project separates them (voice
  separation is a research problem).
- Subject/answer/countersubject entries are **never** labeled in MIDI.
  Write them into a `*.annotations.json` sidecar (time ranges + track +
  tags like `"subject"`, `"voice-2"`), and have the visualizer query
  `annotations.labelsAt(t)` / `labelsWithTag("subject")`. Labeling one
  fugue by ear with a score takes maybe half an hour and unlocks
  everything an analysis algorithm would.

---

## Step 2 — Define the visual mapping

Write a small table for your idea. The two shipped visualizers as examples:

| Musical dimension | Circular Accumulator | Noise Orbit Particles |
|---|---|---|
| time (note start) | angle around circle | angle around circle |
| pitch | radial distance from center | radial distance + color ramp |
| velocity | — | drift amplitude |
| held duration | core disc growth (capped) | "active" pulse while held |
| pedal-sustained duration | translucent halo growth (capped) | "sustain" pulse |
| track | optional color mode | z-depth offset |
| whole-piece structure | one readable mandala | one readable constellation |

Useful mapping vocabulary: time → x/angle/progress · pitch →
radius/height/color · velocity → size/brightness/motion · duration →
length/trail/growth · instrument/track → layer/color/depth · sustain →
halo/afterglow · annotations → emphasis/section changes.

Two constraints to respect from the start:

1. **Everything derives from `t`.** The frame at `t = 12.4` must be
   computable without knowing what was rendered before (the renderer and
   the seek bar both jump around). "Accumulating" visuals are fine — but
   accumulate *as a function of t* (e.g. "all notes with
   `start_seconds <= t`"), never as retained mutable per-frame state.
2. **Design space, not pixels.** Compute in a 1080-tall coordinate system
   and scale (both shipped visualizers show how) so 720p previews and
   1080p renders are the same image.

---

## Step 3 — Define parameters before implementing heavily

For each knob, decide up front:

- **Tweakable** → a `ParamSpec` with `min`/`max` (gets a slider), a
  `group` ("Layout" / "Motion" / "Color" work well), and a `description`
  (becomes the tooltip).
- **Fixed** → a `const` in the file. Not everything deserves a slider;
  20+ params make the panel worse, not better.
- **Randomizable** → add `randomizable: true` *only* where a random value
  can look good (colors, growth rates, noise settings — yes; direction,
  background, structural radii — usually no). The studio's
  Randomize/Mutate buttons only touch these.
- **Needs a seed** → any use of noise/randomness gets a
  `{ type: "seed" }` param, and the implementation must derive **all**
  randomness from it (see below). Never call unseeded `Math.random()` in
  render code — it breaks reproducibility and preview/render parity.
- **Rarely touched** → `advanced: true` hides it behind the "show
  advanced" toggle.

The full ParamSpec reference (types `number`, `color`, `boolean`,
`select`, `vec2`, `vec3`, `range`, `seed`) is in
[GUIDE.md → Visualizer parameters](GUIDE.md#visualizer-interface).

---

## Step 4 — Implement

Start from a template:

- 2D canvas, minimal: `studio/src/visualizers/dev/pitch-roll/`
- Three.js, mesh-per-note: `studio/src/visualizers/final/circular-accumulator/`
- Three.js, particles + seeded noise: `studio/src/visualizers/dev/noise-orbit-particles/`

Copy one to `studio/src/visualizers/dev/<your-id>/`, then work in this
order inside `index.ts`:

1. **`params: [...]`** — encode step 3.
2. **`create(ctx)`** — build everything that does not depend on `t`:
   canvas/renderer, per-note base positions, colors, materials. This runs
   once per (timeline, params) combination.
3. **`renderAtTime(t)`** — pure function of `t`. Use the timing engine
   (`ctx.engine`) for musical state instead of doing tick math:
   `notesActiveAt(t)`, `notesHeldAt(t)`, `notesSustainedAt(t)`,
   `barBeatAt(t)`, `tempoAt(t)`. Per-note timing comes from the note's own
   `start_seconds` / `end_seconds_explicit` / `end_seconds_sounding`.
4. **`dispose()`** — free GPU resources, remove the canvas. Set
   `preserveDrawingBuffer: true` on WebGL renderers (screenshot/canvas
   capture and still export need it).

Deterministic randomness recipe (what noise-orbit-particles does):

```ts
import { createNoise3D } from "simplex-noise";
import { hashString, mulberry32 } from "../../params";

const noise3D = createNoise3D(mulberry32(Number(params.seed)));       // field from seed
const noteOffset = hashString(`${n.track}/${n.channel}/${n.pitch}/${n.start_tick}/${i}`);
const wobble = noise3D(noteOffset % 1000, t * speed, 0);              // pure fn of t
```

---

## Step 5 — Test the idea

1. **Preview** in the studio against `samples/prelude_c` (musical),
   `samples/sustain_demo` (pedal tails), `samples/tempo_change` (tempo map),
   `samples/multitrack` (tracks/channels).
2. **Scrub** the seek bar hard, including backward — any flicker or
   "ghost" element means `renderAtTime` isn't pure.
3. **Inspect**: open the Timeline inspector while paused at interesting
   moments; check that active/held/sustain counts match what you see.
4. **Save a preset** when something looks good — presets record params +
   render settings + timeline, and Randomize results are reproducible
   from the reported seed.
5. **Smoke render** small and fast:
   `npm run render -- --timeline samples/scale.timeline.json --visualizer <id> --fps 12 --width 640 --height 360`
6. **Final render** at defaults (1080p/30), then consider promoting:
   `git mv studio/src/visualizers/dev/<id> studio/src/visualizers/final/<id>`.

---

## Worked micro-example: "voice ribbons" idea

> *Idea: each fugue voice is a colored ribbon flowing left→right; ribbons
> thicken when their voice plays the subject.*

1. **Unit**: voice (per-track if the file is per-voice; else annotate) +
   motif entries (always annotate).
2. **Mapping**: time → x; pitch → y per ribbon; subject entries
   (annotation tag `subject`) → ribbon thickness ×2 + brightness.
3. **Params**: ribbon colors (randomizable), thickness (slider), subject
   emphasis multiplier (slider), background; fixed: margins; no seed
   needed (no randomness).
4. **Implement**: copy pitch-roll; group `engine.notes` by track in
   `create()`; in `renderAtTime(t)` draw segments for notes with
   `start_seconds <= t`, and check
   `ctx.annotations?.labelsAt(note.start_seconds)` for the `subject` tag.
5. **Test** with a hand-labeled `fugue.annotations.json` (five labels are
   enough to see it work).
