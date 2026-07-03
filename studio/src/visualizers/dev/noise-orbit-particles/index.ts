/**
 * Noise Orbit Particles — a deliberately different second visualizer that
 * proves the adaptive parameter UI is not hardcoded for the circular demo:
 * different groups, noise controls, a seed, vec-free but motion-heavy.
 *
 * Mapping:
 *   - One point per note. Base position is polar like the circular demo:
 *     angle = start time over the piece (clockwise from 12 o'clock by
 *     default), radius = middle-C radius + semitone distance from C4,
 *     z = track index spread (visually subtle under the ortho camera but
 *     it decorrelates the noise per track).
 *   - A particle appears at its note's start and stays forever.
 *   - Every particle drifts around its base position with DETERMINISTIC
 *     simplex noise: position(t) is a pure function of (timeline, params),
 *     so scrubbing backward and offline rendering are exact.
 *   - Drift amplitude follows the note's state at time t:
 *       key held            -> activePulse   (big, lively)
 *       pedal-sustained     -> sustainPulse  (medium)
 *       finished            -> restingDrift  (tiny shimmer)
 *     and scales with velocity via velocityInfluence.
 *
 * Determinism: the noise field is seeded from the `seed` param (via
 * mulberry32 feeding simplex-noise's createNoise3D), and each note samples
 * the field at an offset derived from a stable hash of its identity
 * (track/channel/pitch/start_tick/index). No Math.random anywhere in the
 * render path.
 *
 * Dependency note: `simplex-noise` (MIT) was chosen because it is tiny,
 * maintained, tree-shakeable, and accepts a custom PRNG — which is exactly
 * what seeded determinism needs.
 */

import { createNoise3D } from "simplex-noise";
import * as THREE from "three";

import { BACKGROUND } from "../../palette";
import { hashString, mulberry32 } from "../../params";
import type {
  VisualizerContext,
  VisualizerDefinition,
  VisualizerInstance,
} from "../../types";

const DESIGN_HEIGHT = 1080;
/** Parked position for particles whose note hasn't started yet (off-frame). */
const HIDDEN = 1e6;

const definition: VisualizerDefinition = {
  id: "noise-orbit-particles",
  name: "Noise Orbit Particles",
  description:
    "One drifting particle per note, placed like a clock face (angle = "
    + "start time, radius = pitch vs middle C). Particles appear at note "
    + "start, stay forever, and jitter with seeded simplex noise — lively "
    + "while held, calmer while pedal-sustained, near-still afterwards.",
  renderMode: "3d",
  params: [
    // -- Layout ---------------------------------------------------------------
    { key: "direction", label: "Direction", type: "select", group: "Layout",
      default: "clockwise", options: ["clockwise", "counterclockwise"],
      description: "Which way time travels around the circle (from 12 o'clock)." },
    { key: "middleCRadius", label: "Middle C radius (px)", type: "number",
      group: "Layout", default: 230, min: 80, max: 420, step: 10 },
    { key: "pxPerSemitone", label: "Px per semitone", type: "number",
      group: "Layout", default: 6, min: 1, max: 20, step: 0.5 },
    { key: "innerRadius", label: "Inner radius (empty center)", type: "number",
      group: "Layout", default: 80, min: 0, max: 250, step: 5,
      description: "Low notes never drift closer to the center than this." },
    { key: "maxRadial", label: "Max distance from center", type: "number",
      group: "Layout", default: 510, min: 200, max: 540, step: 5, advanced: true },
    { key: "zSpread", label: "Z spread per track", type: "number",
      group: "Layout", default: 40, min: 0, max: 200, step: 5, advanced: true,
      description: "Depth offset between tracks (subtle under the flat camera; "
        + "mainly decorrelates per-track motion)." },

    // -- Motion ---------------------------------------------------------------
    { key: "noiseStrength", label: "Noise strength (px)", type: "number",
      group: "Motion", default: 26, min: 0, max: 120, step: 1, randomizable: true,
      description: "Base drift amplitude before pulses and velocity scaling." },
    { key: "noiseSpeed", label: "Noise speed", type: "number",
      group: "Motion", default: 0.5, min: 0.02, max: 3, step: 0.02,
      randomizable: true,
      description: "How fast a particle wanders through the noise field." },
    { key: "noiseScale", label: "Noise decorrelation", type: "number",
      group: "Motion", default: 1, min: 0.1, max: 4, step: 0.1, advanced: true,
      randomizable: true,
      description: "Spacing between notes in noise space — higher = "
        + "neighboring notes move more independently." },
    { key: "velocityInfluence", label: "Velocity influence", type: "number",
      group: "Motion", default: 0.8, min: 0, max: 2, step: 0.05,
      randomizable: true,
      description: "0 = all notes drift equally; higher = loud notes drift more." },
    { key: "activePulse", label: "Active pulse", type: "number",
      group: "Motion", default: 1.6, min: 0, max: 4, step: 0.1, randomizable: true,
      description: "Drift multiplier while the key is held." },
    { key: "sustainPulse", label: "Sustain pulse", type: "number",
      group: "Motion", default: 0.9, min: 0, max: 4, step: 0.1, randomizable: true,
      description: "Drift multiplier while only the pedal holds the note." },
    { key: "restingDrift", label: "Resting drift", type: "number",
      group: "Motion", default: 0.15, min: 0, max: 2, step: 0.05,
      randomizable: true,
      description: "Residual shimmer after the note has fully stopped." },

    // -- Appearance -----------------------------------------------------------
    { key: "particleSize", label: "Particle size (px)", type: "number",
      group: "Appearance", default: 7, min: 1, max: 30, step: 0.5,
      randomizable: true },
    { key: "lowNoteColor", label: "Low note color", type: "color",
      group: "Appearance", default: "#355c7d", randomizable: true },
    { key: "highNoteColor", label: "High note color", type: "color",
      group: "Appearance", default: "#f8b195", randomizable: true },
    { key: "opacity", label: "Particle opacity", type: "number",
      group: "Appearance", default: 0.9, min: 0.1, max: 1, step: 0.05,
      randomizable: true },
    { key: "backgroundColor", label: "Background", type: "color",
      group: "Appearance", default: BACKGROUND },

    // -- Randomness -----------------------------------------------------------
    { key: "seed", label: "Noise seed", type: "seed", group: "Randomness",
      default: 1234, min: 0, max: 999999, randomizable: true,
      description: "Seeds the whole noise field. Same seed + same params + "
        + "same MIDI = pixel-identical motion." },
  ],
  create(ctx) {
    return new NoiseOrbitParticles(ctx);
  },
};

export default definition;

interface ParticleData {
  startSeconds: number;
  endExplicit: number;
  endSounding: number;
  baseX: number;
  baseY: number;
  baseZ: number;
  /** Per-note offset into the noise field (from the stable identity hash). */
  noiseOffset: number;
  velocityFactor: number;
}

class NoiseOrbitParticles implements VisualizerInstance {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.OrthographicCamera;
  private points: THREE.Points;
  private geometry = new THREE.BufferGeometry();
  private material: THREE.PointsMaterial;
  private positions: Float32Array;
  private particles: ParticleData[] = [];
  private noise3D: (x: number, y: number, z: number) => number;
  private ctx: VisualizerContext;

  constructor(ctx: VisualizerContext) {
    this.ctx = ctx;
    const p = ctx.params;

    // Deterministic noise field: simplex-noise permutation table built from
    // a seeded PRNG instead of Math.random.
    this.noise3D = createNoise3D(mulberry32(Number(p.seed) >>> 0));

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: true, // required for screenshot/canvas capture
    });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(ctx.width, ctx.height);
    ctx.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(String(p.backgroundColor));

    const aspect = ctx.width / ctx.height;
    const halfH = DESIGN_HEIGHT / 2;
    this.camera = new THREE.OrthographicCamera(
      -halfH * aspect, halfH * aspect, halfH, -halfH, 0.1, 4000,
    );
    this.camera.position.z = 2000;

    const notes = ctx.engine.notes;
    const n = notes.length;
    this.positions = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);

    // Pitch range of THIS piece for the low->high color ramp (min 1 octave
    // span so single-pitch test files don't divide by zero).
    let loPitch = 127, hiPitch = 0;
    for (const note of notes) {
      loPitch = Math.min(loPitch, note.pitch);
      hiPitch = Math.max(hiPitch, note.pitch);
    }
    if (hiPitch - loPitch < 12) hiPitch = loPitch + 12;
    const lowColor = new THREE.Color(String(p.lowNoteColor));
    const highColor = new THREE.Color(String(p.highNoteColor));

    const total = ctx.engine.durationSeconds || 1;
    const spin = p.direction === "counterclockwise" ? 1 : -1;
    const noiseScale = Number(p.noiseScale);

    for (let i = 0; i < n; i++) {
      const note = notes[i];
      const progress = note.start_seconds / total;
      const angle = Math.PI / 2 + spin * progress * Math.PI * 2;
      const radial = clamp(
        Number(p.middleCRadius) + (note.pitch - 60) * Number(p.pxPerSemitone),
        Number(p.innerRadius),
        Number(p.maxRadial),
      );

      // Stable per-note identity -> a fixed offset in noise space. Using
      // the hash (not the array index alone) keeps a note's motion stable
      // even if unrelated notes are added to the file.
      const identity =
        `${note.track}/${note.channel}/${note.pitch}/${note.start_tick}/${i}`;
      const noiseOffset = (hashString(identity) % 100000) * 0.001 * noiseScale;

      this.particles.push({
        startSeconds: note.start_seconds,
        endExplicit: note.end_seconds_explicit,
        endSounding: note.end_seconds_sounding,
        baseX: radial * Math.cos(angle),
        baseY: radial * Math.sin(angle),
        baseZ: note.track * Number(p.zSpread),
        noiseOffset,
        velocityFactor: note.velocity / 127,
      });

      const c = lowColor.clone().lerp(
        highColor, (note.pitch - loPitch) / (hiPitch - loPitch));
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
      // Parked off-frame until the note starts.
      this.positions[i * 3] = HIDDEN;
    }

    this.geometry.setAttribute(
      "position", new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute(
      "color", new THREE.BufferAttribute(colors, 3));

    this.material = new THREE.PointsMaterial({
      size: Number(p.particleSize),
      vertexColors: true,
      transparent: true,
      opacity: Number(p.opacity),
      sizeAttenuation: false, // ortho camera: constant pixel size
      depthWrite: false,
      // Round sprite (Points draw as squares by default). Generated
      // procedurally, so it is identical on every machine/run.
      map: makeDiscTexture(),
      alphaTest: 0.4,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false; // parked particles sit far outside
    this.scene.add(this.points);
  }

  renderAtTime(t: number): void {
    const p = this.ctx.params;
    const strength = Number(p.noiseStrength);
    const speed = Number(p.noiseSpeed);
    const velInfluence = Number(p.velocityInfluence);
    const activePulse = Number(p.activePulse);
    const sustainPulse = Number(p.sustainPulse);
    const restingDrift = Number(p.restingDrift);

    for (let i = 0; i < this.particles.length; i++) {
      const d = this.particles[i];
      if (t < d.startSeconds) {
        this.positions[i * 3] = HIDDEN; // not born yet (handles seek-back)
        continue;
      }
      const age = t - d.startSeconds;
      // Note state at t decides how lively the drift is.
      const activity =
        t < d.endExplicit ? activePulse
        : t < d.endSounding ? sustainPulse
        : restingDrift;
      const amplitude =
        strength * (1 + velInfluence * d.velocityFactor) * activity;

      // Three decorrelated samples of the same seeded field; the y=100/200
      // planes keep axes independent. Everything is a pure function of t.
      const s = d.noiseOffset;
      const at = age * speed;
      this.positions[i * 3] = d.baseX + amplitude * this.noise3D(s, at, 0);
      this.positions[i * 3 + 1] = d.baseY + amplitude * this.noise3D(s, at, 100);
      this.positions[i * 3 + 2] = d.baseZ + amplitude * this.noise3D(s, at, 200);
    }
    this.geometry.attributes.position.needsUpdate = true;
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
    this.material.map?.dispose();
    this.material.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/** Soft-edged white disc used as the point sprite (deterministic). */
function makeDiscTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext("2d")!;
  const grad = g.createRadialGradient(
    size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.8, "rgba(255,255,255,1)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}
