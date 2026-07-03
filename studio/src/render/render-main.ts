/**
 * Render page — the deterministic frame target Playwright drives.
 *
 * No UI, no clocks, no playback. The page exposes `window.__viz` with two
 * async methods; the Node render script (renderer/render.js) calls them:
 *
 *   load(payload)   build the visualizer for a timeline + params
 *   renderFrame(t)  draw the exact state for timestamp t, resolve after
 *                   the browser has actually presented the frame
 *
 * Frame content is a pure function of t (see VisualizerInstance contract),
 * so `renderFrame(frame / fps)` + screenshot per frame yields a
 * frame-accurate video regardless of machine speed.
 */

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
}

let instance: VisualizerInstance | null = null;

declare global {
  interface Window {
    __viz: {
      ready: boolean;
      visualizers: string[];
      load(payload: LoadPayload): void;
      renderFrame(t: number): Promise<void>;
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
    });
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
};
