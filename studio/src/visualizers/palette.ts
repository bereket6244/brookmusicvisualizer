/**
 * Centralized color configuration for all visualizers.
 * Change colors here (or per-visualizer via params) — nowhere else.
 */

/** Studio/visualizer default background: deep blue-black. */
export const BACKGROUND = "#0b1020";

/**
 * One color per pitch class (C, C#, D, ... B): a warm-to-cool wheel so
 * harmonically related notes read as related hues on a dark background.
 */
export const PITCH_CLASS_COLORS = [
  "#e8c547", // C  - gold
  "#e09f3e", // C# - amber
  "#e07a5f", // D  - terracotta
  "#d05f7c", // D# - rose
  "#b56dc4", // E  - orchid
  "#7f7cdc", // F  - periwinkle
  "#5d8ee8", // F# - cornflower
  "#4aa8d8", // G  - sky
  "#43bfb4", // G# - teal
  "#57c785", // A  - jade
  "#8fce5e", // A# - leaf
  "#c3d34f", // B  - lime
];

/** Fallback cycle for coloring by track/channel. */
export const TRACK_COLORS = [
  "#e8c547", "#5d8ee8", "#e07a5f", "#57c785",
  "#b56dc4", "#4aa8d8", "#d05f7c", "#8fce5e",
];

export function colorForPitchClass(pitch: number): string {
  return PITCH_CLASS_COLORS[((pitch % 12) + 12) % 12];
}

export function colorForTrack(track: number): string {
  return TRACK_COLORS[track % TRACK_COLORS.length];
}
