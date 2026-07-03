/**
 * Circular Accumulator — the flagship demo visualizer.
 *
 * One circle per note; the image accumulates (nothing ever fades).
 *   - Angle:  note start time mapped over the whole piece to 360°,
 *             starting at 12 o'clock, CLOCKWISE by default (changed from
 *             the first pass's counterclockwise at the owner's request;
 *             a `direction` param keeps CCW available).
 *   - Radius from center: pitch distance from middle C (60). Middle C sits
 *     at `baseRadius` (~200 design px); higher notes farther out, lower
 *     notes inward but never closer than `minRadial`, so the center stays
 *     visibly empty instead of collapsing into a blob.
 *   - Circle size: starts as a dot at note-on and grows while the note
 *     sounds. Two layers keep the two duration kinds distinguishable:
 *       core (opaque disc)      grows at `heldGrowthPerSecond` ONLY while
 *                               the key is held, capped at `maxCoreRadius`
 *       halo (translucent ring) grows at `sustainGrowthPerSecond` while
 *                               the SUSTAIN PEDAL carries the note after
 *                               note-off, capped at maxSustainExtraRadius
 *     Both freeze at their final size forever after the note stops. The
 *     caps are what keep long pedal holds from flooding the image.
 *
 * All geometry is computed in a 1080-tall "design space" and the camera
 * scales it to the actual output size, so a 1280x720 preview and a
 * 1920x1080 render look identical.
 */

import * as THREE from "three";

import type { TimelineNote } from "../../../core/timeline-types";
import {
  BACKGROUND,
  colorForPitchClass,
  colorForTrack,
} from "../../palette";
import type {
  VisualizerContext,
  VisualizerDefinition,
  VisualizerInstance,
} from "../../types";

const DESIGN_HEIGHT = 1080;

const definition: VisualizerDefinition = {
  id: "circular-accumulator",
  name: "Circular Accumulator",
  description:
    "Cumulative circle-per-note portrait of the whole piece. Angle = start "
    + "time (clockwise from top), distance from center = pitch vs middle C, "
    + "size = sounding duration. Opaque core grows while the key is held; "
    + "translucent halo grows while the sustain pedal carries the note. "
    + "Growth is capped so long holds stay readable.",
  renderMode: "3d",
  params: [
    // -- Layout ---------------------------------------------------------------
    { key: "direction", label: "Direction", type: "select", group: "Layout",
      default: "clockwise", options: ["clockwise", "counterclockwise"],
      description: "Which way time travels around the circle (from 12 o'clock)." },
    { key: "baseRadius", label: "Middle C radius (px)", type: "number",
      group: "Layout", default: 220, min: 80, max: 400, step: 10,
      description: "Distance from center where middle C (pitch 60) sits." },
    { key: "pxPerSemitone", label: "Px per semitone", type: "number",
      group: "Layout", default: 7, min: 1, max: 20, step: 0.5,
      description: "Radial spread per semitone away from middle C." },
    { key: "minRadial", label: "Inner radius (empty center)", type: "number",
      group: "Layout", default: 90, min: 0, max: 250, step: 5,
      description: "Low notes never come closer to the center than this — "
        + "keeps a clean empty disc in the middle." },
    { key: "maxRadial", label: "Max distance from center", type: "number",
      group: "Layout", default: 500, min: 200, max: 540, step: 5, advanced: true,
      description: "High notes are clamped to stay inside the frame." },

    // -- Growth ---------------------------------------------------------------
    { key: "dotRadius", label: "Starting dot radius", type: "number",
      group: "Growth", default: 2.5, min: 0.5, max: 10, step: 0.5,
      randomizable: true,
      description: "Circle radius at the instant the note starts." },
    { key: "heldGrowthPerSecond", label: "Held growth px/sec", type: "number",
      group: "Growth", default: 11, min: 1, max: 60, step: 1, randomizable: true,
      description: "Core growth rate while the key is physically held." },
    { key: "maxCoreRadius", label: "Max core radius", type: "number",
      group: "Growth", default: 26, min: 4, max: 120, step: 1, randomizable: true,
      description: "Cap on the opaque core — prevents blob overlap." },
    { key: "sustainGrowthPerSecond", label: "Sustain growth px/sec",
      type: "number", group: "Growth", default: 8, min: 0, max: 40, step: 1,
      randomizable: true,
      description: "Halo growth rate while only the pedal holds the note." },
    { key: "maxSustainExtraRadius", label: "Max sustain halo extra",
      type: "number", group: "Growth", default: 18, min: 0, max: 100, step: 1,
      randomizable: true,
      description: "Cap on how far the pedal halo extends past the core." },

    // -- Color ----------------------------------------------------------------
    { key: "colorMode", label: "Color by", type: "select", group: "Color",
      default: "pitchClass", options: ["pitchClass", "track"], randomizable: true,
      description: "Pitch class = one hue per note letter; track = one hue "
        + "per MIDI track." },
    { key: "coreOpacity", label: "Circle opacity", type: "number",
      group: "Color", default: 0.92, min: 0.1, max: 1, step: 0.02,
      randomizable: true,
      description: "Slightly under 1 lets dense passages layer readably." },
    { key: "haloOpacity", label: "Sustain halo opacity", type: "number",
      group: "Color", default: 0.28, min: 0.05, max: 1, step: 0.02,
      randomizable: true },
    { key: "background", label: "Background", type: "color", group: "Color",
      default: BACKGROUND },
  ],
  create(ctx) {
    return new CircularAccumulator(ctx);
  },
};

export default definition;

interface NoteVisual {
  note: TimelineNote;
  core: THREE.Mesh;
  halo: THREE.Mesh;
}

class CircularAccumulator implements VisualizerInstance {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private visuals: NoteVisual[] = [];
  private geometry = new THREE.CircleGeometry(1, 48);
  private materials = new Map<string, THREE.MeshBasicMaterial>();
  private ctx: VisualizerContext;

  constructor(ctx: VisualizerContext) {
    this.ctx = ctx;
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      // Keeps the drawing buffer readable after render — required for both
      // Playwright screenshots and the canvas.toDataURL capture path.
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(1); // determinism: never scale by devicePixelRatio
    this.renderer.setSize(ctx.width, ctx.height);
    ctx.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(String(ctx.params.background));

    // Orthographic camera showing DESIGN_HEIGHT world units vertically,
    // regardless of output pixel size.
    const aspect = ctx.width / ctx.height;
    const halfH = DESIGN_HEIGHT / 2;
    this.camera = new THREE.OrthographicCamera(
      -halfH * aspect, halfH * aspect, halfH, -halfH, 0.1, 10,
    );
    this.camera.position.z = 1;

    this.buildNoteMeshes();
  }

  private material(color: string, opacity: number): THREE.MeshBasicMaterial {
    const key = `${color}/${opacity}`;
    let mat = this.materials.get(key);
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({
        color,
        transparent: opacity < 1,
        opacity,
        // Painter's-algorithm layering via renderOrder; depth buffer off so
        // translucent halos never z-fight the cores.
        depthTest: false,
        depthWrite: false,
      });
      this.materials.set(key, mat);
    }
    return mat;
  }

  private buildNoteMeshes(): void {
    const p = this.ctx.params;
    const total = this.ctx.engine.durationSeconds || 1;
    const notes = this.ctx.engine.notes;
    // Clockwise = angle DEcreases as time advances (screen-math coords:
    // x right, y up, 12 o'clock = +90°). CCW increases.
    const spin = p.direction === "counterclockwise" ? 1 : -1;

    for (let i = 0; i < notes.length; i++) {
      const note = notes[i];

      const progress = note.start_seconds / total;
      const angle = Math.PI / 2 + spin * progress * Math.PI * 2;

      // Radial position: linear in semitones from middle C, clamped so low
      // notes keep out of the empty center and high notes stay in frame.
      const radial = clamp(
        Number(p.baseRadius) + (note.pitch - 60) * Number(p.pxPerSemitone),
        Number(p.minRadial),
        Number(p.maxRadial),
      );
      const x = radial * Math.cos(angle);
      const y = radial * Math.sin(angle);

      const color = p.colorMode === "track"
        ? colorForTrack(note.track)
        : colorForPitchClass(note.pitch);

      const halo = new THREE.Mesh(
        this.geometry, this.material(color, Number(p.haloOpacity)),
      );
      const core = new THREE.Mesh(
        this.geometry, this.material(color, Number(p.coreOpacity)),
      );
      // Later notes render on top of earlier ones; each note's core sits
      // above its own halo.
      halo.renderOrder = i * 2;
      core.renderOrder = i * 2 + 1;
      halo.position.set(x, y, 0);
      core.position.set(x, y, 0);
      halo.visible = false;
      core.visible = false;
      this.scene.add(halo, core);
      this.visuals.push({ note, core, halo });
    }
  }

  renderAtTime(t: number): void {
    const p = this.ctx.params;
    const dot = Number(p.dotRadius);
    const heldGrowth = Number(p.heldGrowthPerSecond);
    const maxCore = Number(p.maxCoreRadius);
    const susGrowth = Number(p.sustainGrowthPerSecond);
    const maxSusExtra = Number(p.maxSustainExtraRadius);

    for (const { note, core, halo } of this.visuals) {
      if (t < note.start_seconds) {
        // Seeking backward must erase not-yet-started notes.
        core.visible = false;
        halo.visible = false;
        continue;
      }
      // Elapsed sounding time, frozen once the note stops. The core only
      // counts time while the key was held; the halo counts pedal time too.
      const heldElapsed =
        Math.min(t, note.end_seconds_explicit) - note.start_seconds;
      const soundElapsed =
        Math.min(t, note.end_seconds_sounding) - note.start_seconds;

      // Capped growth: cores stop at maxCoreRadius no matter how long the
      // key is held; the pedal halo adds at most maxSustainExtraRadius.
      const coreR = Math.min(dot + heldGrowth * heldElapsed, maxCore);
      const sustainExtra = Math.min(
        susGrowth * Math.max(0, soundElapsed - heldElapsed),
        maxSusExtra,
      );
      const haloR = coreR + sustainExtra;

      core.visible = true;
      core.scale.setScalar(coreR);
      // The halo only shows once the pedal actually extends the note.
      halo.visible = sustainExtra > 0.01;
      if (halo.visible) halo.scale.setScalar(haloR);
    }

    this.renderer.render(this.scene, this.camera);
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height);
    const aspect = width / height;
    const halfH = DESIGN_HEIGHT / 2;
    this.camera.left = -halfH * aspect;
    this.camera.right = halfH * aspect;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.geometry.dispose();
    for (const mat of this.materials.values()) mat.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}
