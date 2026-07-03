/**
 * Approximate audio preview via Web Audio.
 *
 * MIDI is not audio — this is a simple built-in synth (triangle
 * oscillator + envelope) so you can HEAR the timeline while previewing.
 * It is synchronized to the same timeline clock as the visuals: on
 * play we map "timeline seconds" onto AudioContext time and schedule
 * every upcoming note sample-accurately. It is NOT the audio used for
 * final renders (that path is FluidSynth + a SoundFont; see docs).
 *
 * Modes: "off" | "synth". A SoundFont-backed browser mode was evaluated
 * and deliberately NOT included: the free WASM synth options are heavy
 * (multi-MB), need a bundled SoundFont, and add nothing to render
 * correctness (renders never use preview audio). docs/AUDIO_SETUP.md
 * covers the real audio path. driftSeconds() exposes audio-vs-visual
 * clock skew for the studio's inspector.
 */

import type { TimingEngine } from "../core/timing-engine";

interface Voice {
  osc: OscillatorNode;
  gain: GainNode;
}

export class AudioPreview {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private voices: Voice[] = [];
  private scheduleTimer: number | null = null;
  private engine: TimingEngine | null = null;
  /** AudioContext time corresponding to timeline t=0 for this play run. */
  private anchor = 0;
  private scheduledUpTo = 0;
  private running = false;

  mode: "off" | "synth" = "off";

  setEngine(engine: TimingEngine | null): void {
    this.stop();
    this.engine = engine;
  }

  /**
   * Timeline-time skew between the audio clock and the given visual time
   * (positive = audio ahead). Null when audio is off or not playing.
   * The two clocks are anchored together at play start, so this mostly
   * measures wall-clock vs AudioContext drift over a long preview.
   */
  driftSeconds(visualT: number): number | null {
    if (!this.running || !this.ctx) return null;
    const audioT = this.ctx.currentTime - this.anchor;
    return audioT - visualT;
  }

  /** Begin audible playback from timeline time `fromT`. */
  start(fromT: number): void {
    if (this.mode === "off" || !this.engine) return;
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.6;
      this.master.connect(this.ctx.destination);
    }
    void this.ctx.resume();
    this.running = true;
    this.anchor = this.ctx.currentTime + 0.05 - fromT;
    this.scheduledUpTo = fromT;
    // Rolling scheduler: keep ~2s of notes queued ahead of the playhead.
    this.scheduleWindow(fromT);
    this.scheduleTimer = window.setInterval(() => {
      const nowT = this.ctx!.currentTime - this.anchor;
      this.scheduleWindow(nowT);
    }, 500);
  }

  private scheduleWindow(nowT: number): void {
    if (!this.ctx || !this.engine || !this.master) return;
    const horizon = nowT + 2.0;
    if (horizon <= this.scheduledUpTo) return;
    const notes = this.engine.notesStartingBetween(this.scheduledUpTo, horizon);
    for (const n of notes) {
      const startAt = this.anchor + n.start_seconds;
      // Sounding duration so pedal-sustained notes ring appropriately.
      const stopAt = this.anchor + n.end_seconds_sounding;
      const osc = this.ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = 440 * Math.pow(2, (n.pitch - 69) / 12);
      const gain = this.ctx.createGain();
      const peak = (n.velocity / 127) * 0.22;
      gain.gain.setValueAtTime(0, startAt);
      gain.gain.linearRampToValueAtTime(peak, startAt + 0.012);
      // Gentle piano-ish decay toward the release point.
      gain.gain.exponentialRampToValueAtTime(
        Math.max(peak * 0.25, 0.001), Math.max(stopAt - 0.02, startAt + 0.03));
      gain.gain.linearRampToValueAtTime(0, stopAt + 0.06);
      osc.connect(gain).connect(this.master);
      osc.start(startAt);
      osc.stop(stopAt + 0.1);
      const voice = { osc, gain };
      osc.onended = () => {
        this.voices = this.voices.filter((v) => v !== voice);
      };
      this.voices.push(voice);
    }
    this.scheduledUpTo = horizon;
  }

  /** Silence and cancel everything scheduled (pause/seek/stop). */
  stop(): void {
    this.running = false;
    if (this.scheduleTimer !== null) {
      clearInterval(this.scheduleTimer);
      this.scheduleTimer = null;
    }
    for (const v of this.voices) {
      try {
        v.osc.onended = null;
        v.osc.stop();
        v.osc.disconnect();
        v.gain.disconnect();
      } catch { /* already stopped */ }
    }
    this.voices = [];
  }
}
