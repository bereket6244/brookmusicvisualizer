/**
 * Pitch Roll — a deliberately tiny DEV visualizer.
 *
 * Serves two purposes: (1) a piano-roll "ground truth" view that makes it
 * easy to eyeball whether timeline timing is correct, and (2) a template
 * showing how little code a 2D-canvas visualizer needs. Held time renders
 * solid; pedal-sustained tails render translucent. A playhead sweeps
 * left to right.
 */

import { BACKGROUND, colorForPitchClass } from "../../palette";
import type {
  VisualizerContext,
  VisualizerDefinition,
  VisualizerInstance,
} from "../../types";

const definition: VisualizerDefinition = {
  id: "pitch-roll",
  name: "Pitch Roll (debug)",
  description:
    "Simple piano-roll timing reference. Solid bar = key held, translucent "
    + "tail = pedal-sustained. Vertical line = current time.",
  renderMode: "2d",
  params: [
    { key: "background", label: "Background", type: "color", default: BACKGROUND },
    { key: "dimFuture", label: "Dim notes not yet reached", type: "boolean",
      default: true },
  ],
  create(ctx): VisualizerInstance {
    const canvas = document.createElement("canvas");
    canvas.width = ctx.width;
    canvas.height = ctx.height;
    ctx.container.appendChild(canvas);
    const g = canvas.getContext("2d")!;

    const total = ctx.engine.durationSeconds || 1;
    const notes = ctx.engine.notes;
    const pitches = notes.map((n) => n.pitch);
    const lo = Math.min(...pitches, 60) - 2;
    const hi = Math.max(...pitches, 60) + 2;

    const xAt = (t: number) => (t / total) * canvas.width;
    const yAt = (pitch: number) =>
      canvas.height - ((pitch - lo) / (hi - lo)) * canvas.height;
    const rowH = Math.max(2, canvas.height / (hi - lo) - 2);

    return {
      renderAtTime(t: number) {
        g.fillStyle = String(ctx.params.background);
        g.fillRect(0, 0, canvas.width, canvas.height);
        for (const n of notes) {
          const color = colorForPitchClass(n.pitch);
          const y = yAt(n.pitch) - rowH / 2;
          const dim = ctx.params.dimFuture && n.start_seconds > t;
          // Pedal-sustained tail (drawn first, underneath the held bar).
          if (n.end_seconds_sounding > n.end_seconds_explicit) {
            g.globalAlpha = dim ? 0.08 : 0.3;
            g.fillStyle = color;
            g.fillRect(xAt(n.end_seconds_explicit), y,
              xAt(n.end_seconds_sounding) - xAt(n.end_seconds_explicit), rowH);
          }
          g.globalAlpha = dim ? 0.18 : 1;
          g.fillStyle = color;
          g.fillRect(xAt(n.start_seconds), y,
            Math.max(1, xAt(n.end_seconds_explicit) - xAt(n.start_seconds)),
            rowH);
        }
        g.globalAlpha = 1;
        g.strokeStyle = "#ffffff";
        g.beginPath();
        g.moveTo(xAt(t), 0);
        g.lineTo(xAt(t), canvas.height);
        g.stroke();
      },
      resize(w: number, h: number) {
        canvas.width = w;
        canvas.height = h;
      },
      dispose() {
        canvas.remove();
      },
    };
  },
};

export default definition;
