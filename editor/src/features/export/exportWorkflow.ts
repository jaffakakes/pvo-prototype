import { captureExportSnapshot, completedExport } from "../../domain/publishing/exportSnapshot";
import type { ExportFormat, ExportSnapshot, ExportStage } from "../../domain/publishing/model";
import { canRenderSceneOnServer } from "../../domain/export/serverRenderEligibility";
import { exportVideo, type ExportResult, type VideoExportSource } from "../../infrastructure/media/exportVideo";
import { createServerSceneRenderer, type ServerSceneRenderer } from "../../infrastructure/media/serverRender";
import { exportPvo, type SceneRenderer } from "./exportPvo";

export type ExportOptions = { signal?: AbortSignal; stage?: (value: ExportStage) => void; poster?: Blob | null };

type Adapters = {
  video(source: VideoExportSource, progress: (fraction: number) => void, signal?: AbortSignal): Promise<ExportResult>;
  pvo(source: ExportSnapshot, progress: (fraction: number) => void, renderScene?: SceneRenderer, poster?: Blob | null): Promise<ExportResult>;
  server?: () => ServerSceneRenderer;
  readMedia(url: string, signal?: AbortSignal): Promise<Blob>;
  createUrl(blob: Blob): string;
  revokeUrl(url: string): void;
  now(): string;
};
const defaults: Adapters = {
  video: exportVideo, pvo: exportPvo,
  server: createServerSceneRenderer,
  readMedia: async (url, signal) => {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error("An export clip could not be read.");
    return response.blob();
  },
  createUrl: blob => URL.createObjectURL(blob), revokeUrl: url => URL.revokeObjectURL(url),
  now: () => new Date().toISOString(),
};

/** Lease local media for this immutable snapshot; a project reset cannot revoke an active render's inputs. */
export async function renderCompletedExport(snapshot: ExportSnapshot, format: ExportFormat,
  progress: (fraction: number) => void, adapters: Adapters = defaults, options: ExportOptions = {}) {
  const source = captureExportSnapshot(snapshot, snapshot.snapshotId);
  const media = new Map<string, { url: string; blob: Blob }>();
  const clips = source.scenes.filter(scene => format === "pvo" || scene.id === "main").flatMap(scene => [...scene.clips, ...(scene.audioClips ?? [])]);
  try {
    options.stage?.("preparing");
    // Start all Blob reads before yielding, so source URLs are retained even if the user resets immediately.
    const reads = [...new Set(clips.flatMap(clip => clip.url ? [clip.url] : []))].map(async url => {
      const blob = await adapters.readMedia(url, options.signal);
      media.set(url, { url: adapters.createUrl(blob), blob });
    });
    const results = await Promise.allSettled(reads);
    const failed = results.find(result => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
    for (const clip of clips) if (clip.url) clip.url = media.get(clip.url)?.url ?? clip.url;
    const main = source.scenes.find(scene => scene.id === "main");
    if (!main) throw new Error("Main scene is missing from this project.");
    const remote = adapters.server?.();
    const leasedMedia = new Map([...media.values()].map(({ url, blob }) => [url, blob]));
    const renderScene: SceneRenderer = async (scene, onPct) => {
      options.signal?.throwIfAborted();
      if (remote && canRenderSceneOnServer(scene)) {
        const result = await remote(scene, leasedMedia, onPct, options.signal, options.stage);
        if (result) return result;
      }
      options.signal?.throwIfAborted();
      options.stage?.("browser");
      return adapters.video(scene, onPct, options.signal);
    };
    const result = format === "pvo" ? await adapters.pvo(source, progress, renderScene, options.poster)
      : await renderScene({ ...main, ratio: source.ratio, quality: source.quality }, progress);
    try { return { artifact: completedExport(snapshot, format, result, adapters.now(), options.poster ?? null), url: result.url }; }
    catch (error) { adapters.revokeUrl(result.url); throw error; }
  } finally {
    for (const lease of media.values()) adapters.revokeUrl(lease.url);
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
