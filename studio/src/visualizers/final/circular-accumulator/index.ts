/**
 * Circular Accumulator — the required demo visualizer.
 *
 * One circle per note; the image accumulates (nothing ever fades).
 *   - Angle:  note start time mapped over the whole piece to 360°,
 *             starting at 12 o'clock, COUNTERCLOCKWISE (documented choice,
 *             matching the user's earlier static experiment).
 *   - Radius from center: pitch distance from middle C (60). Middle C sits
 *     at `baseRadius` (~200 design px); higher notes farther out, lower
 *     notes inward, clamped so extremes stay visible and in frame.
 *   - Circle size: starts as a dot at note-on and grows while the note
 *     sounds. Two layers make the two duration kinds distinguishable:
 *       core (opaque disc)      grows only while the KEY IS HELD
 *       halo (translucent disc) keeps growing while the SUSTAIN PEDAL
 *                               carries the note after note-off
 *     Both freeze at their final size forever after the note stops.
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
    + "time (counterclockwise from top), distance from center = pitch vs "
    + "middle C, size = sounding duration. Opaque core grows while the key "
    + "is held; translucent halo keeps growing while the sustain pedal "
    + "carries the note.",
  renderMode: "3d",
  params: [
    { key: "baseRadius", label: "Middle C radius (px)", type: "number",
      default: 200, min: 50, max: 400, step: 10 },
    { key: "pxPerSemitone", label: "Px per semitone", type: "number",
      default: 7, min: 1, max: 20, step: 0.5 },
    { key: "minRadial", label: "Min distance from center", type: "number",
      default: 40, min: 0, max: 200, step: 5 },
    { key: "maxRadial", label: "Max distance from center", type: "number",
      default: 500, min: 200, max: 540, step: 5 },
    { key: "dotRadius", label: "Starting dot radius", type: "number",
      default: 3, min: 1, max: 10, step: 0.5 },
    { key: "growthPerSecond", label: "Growth px/sec", type: "number",
      default: 16, min: 2, max: 60, step: 1 },
    { key: "haloOpacity", label: "Sustain halo opacity", type: "number",
      default: 0.35, min: 0.05, max: 1, step: 0.05 },
    { key: "colorMode", label: "Color by", type: "select",
      default: "pitchClass", options: ["pitchClass", "track"] },
    { key: "background", label: "Background", type: "color",
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
      // Keeps the drawing buffer readable after render — required for
      // Playwright screenshots to reliably capture the last frame.
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

    for (let i = 0; i < notes.length; i++) {
      const note = notes[i];

      // Angular position: piece progress -> full turn, counterclockwise
      // starting from the top (+y axis). In math coords (x right, y up)
      // the top is +90°, and CCW means the angle increases with time.
      const progress = note.start_seconds / total;
      const angle = Math.PI / 2 + progress * Math.PI * 2;

      // Radial position: linear in semitones from middle C, clamped.
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
      const core = new THREE.Mesh(this.geometry, this.material(color, 1));
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
    const dot = Number(this.ctx.params.dotRadius);
    const growth = Number(this.ctx.params.growthPerSecond);

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

      const coreR = dot + growth * heldElapsed;
      const haloR = dot + growth * soundElapsed;

      core.visible = true;
      core.scale.setScalar(coreR);
      // The halo only becomes visible once it outgrows the core, i.e. when
      // the sustain pedal is carrying the note beyond the key release.
      halo.visible = haloR > coreR + 0.01;
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
