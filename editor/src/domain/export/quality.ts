import type { Ratio } from "../project/model";
import { projectRatio } from "../project/ratio";
import type { ExportQuality } from "../publishing/model";

/** The named quality is the short edge, including portrait and square projects. */
export function exportFrameSize(ratio: Ratio, quality: ExportQuality) {
  const [rw, rh] = projectRatio(ratio);
  const short = quality === "4K" ? 2160 : quality === "1080p" ? 1080 : 720;
  return rw <= rh
    ? { width: short, height: Math.round(short * rh / rw / 2) * 2 }
    : { width: Math.round(short * rw / rh / 2) * 2, height: short };
}

/** Approximate encoded file size for the export picker; actual bitrate can vary. */
export function estimatedExportBytes(seconds: number, quality: ExportQuality) {
  const bitsPerSecond = quality === "4K" ? 30_000_000 : quality === "1080p" ? 12_000_000 : 6_000_000;
  return Math.max(1, seconds * bitsPerSecond / 8);
}
