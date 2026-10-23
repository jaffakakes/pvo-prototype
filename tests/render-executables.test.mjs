import assert from "node:assert/strict";
import test from "node:test";
import { adjacentFfprobe } from "../scripts/dev/render-jobs/executables.mjs";
test("FFprobe follows explicit configuration, sibling paths and PATH commands", () => {
  for (const [ffmpeg, platform, expected] of [
    [
      "C:\\Tools\\FFmpeg\\bin\\ffmpeg.exe",
      "win32",
      "C:\\Tools\\FFmpeg\\bin\\ffprobe.exe",
    ],
    [
      "C:/Tools/FFmpeg/bin/ffmpeg.exe",
      "win32",
      "C:\\Tools\\FFmpeg\\bin\\ffprobe.exe",
    ],
    ["tools/ffmpeg.exe", "win32", "tools\\ffprobe.exe"],
    ["/opt/homebrew/bin/ffmpeg", "darwin", "/opt/homebrew/bin/ffprobe"],
    ["tools/ffmpeg", "linux", "tools/ffprobe"],
    ["ffmpeg", "darwin", "ffprobe"],
    ["ffmpeg", "win32", "ffprobe"],
    ["ffmpeg.exe", "win32", "ffprobe.exe"],
  ]) {
    assert.equal(adjacentFfprobe(ffmpeg, undefined, platform), expected);
    assert.equal(
      adjacentFfprobe(ffmpeg, "custom-probe", platform),
      "custom-probe",
    );
  }
});
