/**
 * FFmpeg orchestration. The `ffmpeg-static` npm package ships a real
 * ffmpeg binary (no manual install needed on Windows); a system ffmpeg on
 * PATH is used as fallback if the package somehow lacks a binary.
 */

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export function resolveFfmpeg() {
  try {
    const ffmpegStatic = require("ffmpeg-static");
    if (ffmpegStatic) return ffmpegStatic;
  } catch { /* fall through to PATH */ }
  return "ffmpeg";
}

function run(args, label) {
  const ffmpeg = resolveFfmpeg();
  const result = spawnSync(ffmpeg, args, {
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error?.code === "ENOENT") {
    throw new Error(
      "ffmpeg not found. `npm install` should have provided ffmpeg-static; "
      + "alternatively install ffmpeg and add it to PATH.",
    );
  }
  if (result.status !== 0) {
    // ffmpeg logs everything to stderr; surface the tail, not 500 lines.
    const tail = (result.stderr || "").split("\n").slice(-15).join("\n");
    throw new Error(`${label} failed (ffmpeg exit ${result.status}):\n${tail}`);
  }
}

/** Assemble numbered PNG frames into an H.264 MP4. */
export function encodeFrames(framesPattern, fps, outPath) {
  run(
    [
      "-y",
      "-framerate", String(fps),
      "-i", framesPattern,
      "-c:v", "libx264",
      "-preset", "medium",
      "-crf", "18",
      // yuv420p is required for broad player compatibility (QuickTime etc.)
      "-pix_fmt", "yuv420p",
      outPath,
    ],
    "frame encoding",
  );
}

/** Mux a WAV audio track into an existing video (video stream copied). */
export function muxAudio(videoPath, audioPath, outPath) {
  run(
    [
      "-y",
      "-i", videoPath,
      "-i", audioPath,
      "-c:v", "copy",
      "-c:a", "aac",
      "-b:a", "192k",
      // -shortest: audio and video lengths can differ by the render tail;
      // cut to the shorter so the file ends cleanly.
      "-shortest",
      outPath,
    ],
    "audio muxing",
  );
}
