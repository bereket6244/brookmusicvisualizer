/**
 * Render page — the deterministic frame target Playwright drives.
 *
 * No UI, no clocks, no playback. The page exposes `window.__viz` with
 * methods the Node render script (renderer/render.js) calls:
 *
 *   load(payload)    build the visualizer for a timeline + params
 *   renderFrame(t)   draw the exact state for timestamp t, resolve after
 *                    the browser has actually presented the frame
 *                    (screenshot capture mode)
 *   captureFrame(t)  draw the exact state for t and return the canvas
 *                    pixels as a PNG data URL (fast canvas capture mode —
 *                    no compositor wait needed because we read the
 *                    canvas buffer directly, not the screen)
 *
 * Frame content is a pure function of t (see VisualizerInstance contract),
 * so either capture path yields a frame-accurate video regardless of
 * machine speed.
 */

import type { AnnotationFile } from "../core/annotations";
import { parseAnnotations } from "../core/annotations";
import type { Timeline } from "../core/timeline-types";
import { TimingEngine } from "../core/timing-engine";
import { getVisualizer, listVisualizers } from "../visualizers/registry";
import type { ParamValues, VisualizerInstance } from "../visualizers/types";
import { defaultParams } from "../visualizers/types";

interface LoadPayload {
  timeline: Timeline;
  visualizerId: string;
  params?: ParamValues;
  width: number;
  height: number;
  /** Optional annotation sidecar content (same as the studio would load). */
  annotations?: AnnotationFile;
}

let instance: VisualizerInstance | null = null;
let canvas: HTMLCanvasElement | null = null;

declare global {
  interface Window {
    __viz: {
      ready: boolean;
      visualizers: string[];
      load(payload: LoadPayload): void;
      renderFrame(t: number): Promise<void>;
      captureFrame(t: number): string;
    };
  }
}

window.__viz = {
  ready: true,
  visualizers: listVisualizers().map((v) => v.id),

  load(payload: LoadPayload): void {
    const def = getVisualizer(payload.visualizerId);
    if (!def) {
      throw new Error(
        `unknown visualizer "${payload.visualizerId}". `
        + `Available: ${listVisualizers().map((v) => v.id).join(", ")}`);
    }
    instance?.dispose();
    const stage = document.getElementById("stage")!;
    stage.innerHTML = "";
    instance = def.create({
      container: stage,
      width: payload.width,
      height: payload.height,
      engine: new TimingEngine(payload.timeline),
      params: { ...defaultParams(def), ...(payload.params ?? {}) },
      annotations: payload.annotations
        ? parseAnnotations(payload.annotations)
        : undefined,
    });
    // Canvas capture reads pixels straight off the visualizer's canvas.
    // Requires the canvas to be the full frame (all bundled visualizers
    // create exactly one full-size canvas) and, for WebGL, that the
    // context was created with preserveDrawingBuffer: true.
    canvas = stage.querySelector("canvas");
  },

  async renderFrame(t: number): Promise<void> {
    if (!instance) throw new Error("call load() before renderFrame()");
    instance.renderAtTime(t);
    // Two rAFs guarantee the compositor has presented the new frame before
    // Playwright takes the screenshot (one rAF only queues the paint).
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  },

  captureFrame(t: number): string {
    if (!instance) throw new Error("call load() before captureFrame()");
    if (!canvas) throw new Error("visualizer has no canvas to capture");
    instance.renderAtTime(t);
    // Synchronous readback: for WebGL this forces the GPU to finish the
    // draw before copying pixels, so no rAF/compositor wait is needed.
    return canvas.toDataURL("image/png");
  },
};
