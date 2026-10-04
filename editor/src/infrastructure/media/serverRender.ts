import { canRenderSceneOnServer } from "../../domain/export/serverRenderEligibility";
import type { VideoExportSource, ExportResult } from "./exportVideo";
import type { ExportQuality } from "../../domain/publishing/model";

export type ServerRenderStage = "uploading" | "rendering" | "downloading";
export type ServerSceneRenderer = (
  source: VideoExportSource,
  media: ReadonlyMap<string, Blob>,
  progress: (fraction: number) => void,
  signal?: AbortSignal,
  stage?: (value: ServerRenderStage) => void,
) => Promise<ExportResult | null>;

type Capability = {
  available: boolean;
  maxSourceBytes: number;
  maxSources: number;
  formats: string[];
  qualities: ExportQuality[];
};
type RenderStatus = "uploading" | "queued" | "rendering" | "ready" | "failed" | "cancelled";
type Job = { id: string; status: RenderStatus; progress: number; error?: string };
type MediaAsset = { id: string; bytes: number; contentType: string; blob: Blob };
type Options = { origin?: string; fetch?: typeof fetch; pollMs?: number };

class ServerRenderError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "ServerRenderError";
  }
}

function finiteFraction(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value)) : 0;
}

function renderJob(value: unknown): Job {
  if (!value || typeof value !== "object") throw new Error("The render service returned an invalid job.");
  const result = value as Record<string, unknown>;
  if (typeof result.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(result.id)
    || !["uploading", "queued", "rendering", "ready", "failed", "cancelled"].includes(String(result.status)))
    throw new Error("The render service returned an invalid job.");
  return {
    id: result.id,
    status: result.status as RenderStatus,
    progress: finiteFraction(result.progress),
    error: typeof result.error === "string" ? result.error.slice(0, 240) : undefined,
  };
}

function remoteSource(source: VideoExportSource, media: ReadonlyMap<string, Blob>) {
  const ids = new Map<string, string>();
  const assets: MediaAsset[] = [];
  const assetId = (url: string | null): string | null => {
    if (!url) return null;
    const prior = ids.get(url);
    if (prior) return prior;
    const blob = media.get(url);
    if (!blob?.size) throw new Error("An original export clip could not be read.");
    const id = `asset_${assets.length}`;
    ids.set(url, id);
    assets.push({ id, bytes: blob.size, contentType: blob.type || "application/octet-stream", blob });
    return id;
  };
  return {
    source: {
      ratio: source.ratio,
      quality: source.quality,
      muted: source.muted,
      sound: source.sound,
      includeText: source.includeText !== false,
      clips: source.clips.map((clip) => ({
        id: clip.id, url: assetId(clip.url), color: clip.color, srcDur: clip.srcDur, in: clip.in, out: clip.out,
        speed: clip.speed, zoom: clip.zoom, mirror: clip.mirror, fit: clip.fit,
        width: clip.width, height: clip.height,
        audioDetached: clip.audioDetached === true,
      })),
      audioClips: source.audioClips?.map((clip) => ({
        id: clip.id, srcDur: clip.srcDur, url: assetId(clip.url), in: clip.in, out: clip.out, speed: clip.speed,
        start: clip.start, muted: clip.muted,
      })),
      // Only timing survives the request. The renderer does not need text,
      // component content, authored actions, source names, or destinations.
      texts: source.texts.map(({ id, start, end }) => ({ id, start, end })),
      components: source.components.map(({ id, at, dur }) => ({ id, at, dur })),
      layers: source.layers?.slice(),
    },
    assets,
  };
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new DOMException("Cancelled", "AbortError"));
    const timer = setTimeout(done, ms);
    function done() { signal?.removeEventListener("abort", aborted); resolve(); }
    function aborted() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", aborted);
      reject(signal?.reason ?? new DOMException("Cancelled", "AbortError"));
    }
    signal?.addEventListener("abort", aborted, { once: true });
  });
}

/** Account-scoped same-origin rendering. Never sends a blob URL or browser export to the service. */
export function createServerSceneRenderer(options: Options = {}): ServerSceneRenderer {
  const origin = options.origin ?? location.origin;
  const send = options.fetch ?? fetch;
  let capability: Promise<Capability | null> | undefined;
  const request = async (path: string, init: RequestInit, signal?: AbortSignal) =>
    send(new URL(path, origin).href, {
      ...init, credentials: "same-origin", redirect: "error", cache: "no-store", signal,
    });
  const readJson = async (response: Response): Promise<unknown> => {
    if (!response.headers.get("Content-Type")?.includes("application/json"))
      throw new Error("The render service returned an unexpected response.");
    return response.json();
  };
  const checkedJson = async (path: string, init: RequestInit, signal?: AbortSignal): Promise<unknown> => {
    const response = await request(path, init, signal);
    if (!response.ok) {
      const body = await readJson(response).catch(() => null);
      const error = body && typeof body === "object" && "error" in body && typeof body.error === "string"
        ? body.error : "The server could not render this video. Try again.";
      throw new ServerRenderError(response.status, error);
    }
    return readJson(response);
  };
  const probe = async (): Promise<Capability | null> => {
    try {
      const response = await request("/api/renders", { method: "GET" });
      if (!response.ok || !response.headers.get("Content-Type")?.includes("application/json")) return null;
      const value = await response.json() as Partial<Capability>;
      return value.available === true && Array.isArray(value.formats) && value.formats.includes("video")
        && Array.isArray(value.qualities) && value.qualities.every(quality => ["720p", "1080p", "4K"].includes(quality))
        && Number.isSafeInteger(value.maxSourceBytes) && (value.maxSourceBytes ?? 0) > 0
        && Number.isSafeInteger(value.maxSources) && (value.maxSources ?? 0) > 0
        ? value as Capability : null;
    } catch { return null; }
  };
  const removeJob = async (id: string) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try { await request(`/api/renders/${id}`, { method: "DELETE" }, controller.signal); }
    catch { /* Server expiry is the fallback cleanup if the network is unavailable. */ }
    finally { clearTimeout(timer); }
  };
  return async (source, media, progress, signal, stage) => {
    signal?.throwIfAborted();
    if (!canRenderSceneOnServer(source)) return null;
    const prepared = remoteSource(source, media);
    capability ??= probe();
    const supported = await capability;
    signal?.throwIfAborted();
    if (!supported || !supported.qualities.includes(source.quality) || prepared.assets.length > supported.maxSources
      || prepared.assets.some((asset) => asset.bytes > supported.maxSourceBytes)) return null;
    let jobId: string | null = null;
    try {
      const created = renderJob(await checkedJson("/api/renders", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: prepared.source, assets: prepared.assets.map(({ blob: _blob, ...asset }) => asset) }),
      }, signal));
      if (created.status !== "uploading") throw new Error("The render service could not accept this video.");
      jobId = created.id;
      stage?.("uploading");
      progress(0.02);
      const totalBytes = prepared.assets.reduce((sum, asset) => sum + asset.bytes, 0);
      let uploadedBytes = 0;
      for (const asset of prepared.assets) {
        signal?.throwIfAborted();
        await checkedJson(`/api/renders/${jobId}/sources/${asset.id}`, {
          method: "PUT", headers: { "Content-Type": asset.contentType }, body: asset.blob,
        }, signal);
        uploadedBytes += asset.bytes;
        progress(0.02 + 0.32 * (totalBytes ? uploadedBytes / totalBytes : 1));
      }
      const queued = renderJob(await checkedJson(`/api/renders/${jobId}/start`, { method: "POST" }, signal));
      if (queued.id !== jobId) throw new Error("The render service returned a different job.");
      stage?.("rendering");
      progress(0.35);
      const deadline = Date.now() + 30 * 60 * 1000;
      for (;;) {
        signal?.throwIfAborted();
        const current = renderJob(await checkedJson(`/api/renders/${jobId}`, { method: "GET" }, signal));
        if (current.id !== jobId) throw new Error("The render service returned a different job.");
        if (current.status === "failed") throw new Error(current.error || "The server could not render this video. Try again.");
        if (current.status === "cancelled") throw new DOMException("Cancelled", "AbortError");
        progress(0.35 + 0.57 * current.progress);
        if (current.status === "ready") break;
        if (Date.now() >= deadline) throw new Error("The server render timed out. Try again.");
        await wait(options.pollMs ?? 1000, signal);
      }
      stage?.("downloading");
      const response = await request(`/api/renders/${jobId}/result`, { method: "GET" }, signal);
      if (!response.ok || !response.headers.get("Content-Type")?.startsWith("video/mp4"))
        throw new Error("The rendered video could not be downloaded.");
      const blob = await response.blob();
      if (!blob.size) throw new Error("The rendered video was empty.");
      progress(1);
      return { blob, url: URL.createObjectURL(blob), name: "restyle-video.mp4" };
    } catch (error) {
      if (error instanceof ServerRenderError && (error.status === 413 || error.status === 422) && !jobId)
        return null;
      throw error;
    } finally {
      if (jobId) await removeJob(jobId);
    }
  };
}
