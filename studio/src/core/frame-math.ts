/**
 * Frame <-> timestamp math. THE deterministic-rendering contract:
 * every frame's content is a pure function of `frameTime(n, fps)`.
 * No wall clocks, no playback capture.
 */

export function frameTime(frameNumber: number, fps: number): number {
  return frameNumber / fps;
}

/** Frames needed to cover a piece, plus an optional still tail. */
export function frameCount(
  durationSeconds: number,
  fps: number,
  tailSeconds = 0,
): number {
  return Math.ceil((durationSeconds + tailSeconds) * fps);
}
