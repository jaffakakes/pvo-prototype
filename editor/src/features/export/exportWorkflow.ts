import { captureExportSnapshot, completedExport } from "../../domain/publishing/exportSnapshot";
import type { ExportFormat, ExportSnapshot } from "../../domain/publishing/model";
import { exportVideo, type ExportResult, type VideoExportSource } from "../../infrastructure/media/exportVideo";
import { exportPvo } from "./exportPvo";

type Adapters = {
  video(source: VideoExportSource, progress: (fraction: number) => void): Promise<ExportResult>;
  pvo(source: ExportSnapshot, progress: (fraction: number) => void): Promise<ExportResult>;
  readMedia(url: string): Promise<Blob>;
  createUrl(blob: Blob): string;
  revokeUrl(url: string): void;
  now(): string;
};
const defaults: Adapters = {
  video: exportVideo, pvo: exportPvo,
  readMedia: async url => {
    const response = await fetch(url);
    if (!response.ok) throw new Error("An export clip could not be read.");
    return response.blob();
  },
  createUrl: blob => URL.createObjectURL(blob), revokeUrl: url => URL.revokeObjectURL(url),
  now: () => new Date().toISOString(),
};

/** Lease local media for this immutable snapshot; a project reset cannot revoke an active render's inputs. */
export async function renderCompletedExport(snapshot: ExportSnapshot, format: ExportFormat,
  progress: (fraction: number) => void, adapters: Adapters = defaults) {
  const source = captureExportSnapshot(snapshot, snapshot.snapshotId);
  const media = new Map<string, string>();
  const clips = source.scenes.filter(scene => format === "pvo" || scene.id === "main").flatMap(scene => [...scene.clips, ...(scene.audioClips ?? [])]);
  try {
    // Start all Blob reads before yielding, so source URLs are retained even if the user resets immediately.
    const reads = [...new Set(clips.flatMap(clip => clip.url ? [clip.url] : []))].map(async url => {
      const blob = await adapters.readMedia(url);
      media.set(url, adapters.createUrl(blob));
    });
    const results = await Promise.allSettled(reads);
    const failed = results.find(result => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
    for (const clip of clips) if (clip.url) clip.url = media.get(clip.url) ?? clip.url;
    const main = source.scenes.find(scene => scene.id === "main");
    if (!main) throw new Error("Main scene is missing from this project.");
    const result = format === "pvo" ? await adapters.pvo(source, progress)
      : await adapters.video({ ...main, ratio: source.ratio, quality: source.quality }, progress);
    try { return { artifact: completedExport(snapshot, format, result, adapters.now()), url: result.url }; }
    catch (error) { adapters.revokeUrl(result.url); throw error; }
  } finally {
    for (const url of media.values()) adapters.revokeUrl(url);
  }
}

export function downloadCompletedExport(url: string, filename: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
}
