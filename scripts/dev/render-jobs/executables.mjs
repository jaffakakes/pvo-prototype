import { win32, posix } from "node:path";

/** Discover siblings using the executable's path syntax, preserving PATH lookup. */
export function adjacentFfprobe(ffmpeg, explicit, platform = process.platform) {
  if (explicit) return explicit;
  if (!/[\\/]/.test(ffmpeg))
    return /\.exe$/i.test(ffmpeg) ? "ffprobe.exe" : "ffprobe";
  const windows = platform === "win32" || /\\|^[A-Za-z]:|\.exe$/i.test(ffmpeg);
  const path = windows ? win32 : posix;
  return path.join(path.dirname(ffmpeg), windows ? "ffprobe.exe" : "ffprobe");
}
