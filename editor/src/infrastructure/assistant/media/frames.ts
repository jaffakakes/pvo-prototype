import type { NativeObservation } from "../../../../../packages/pvo-assistant/native/index.js";
import { drawSceneFrame } from "../../media/drawSceneFrame";
import { inspectionFrames, inspectionScene, type FrameRequest, type InspectionProject } from "../../../domain/assistant/mediaInspection";
import { layerOrder } from "../../../domain/layers/order";
import { projectRatio } from "../../../domain/project/ratio";
import { cancellable, projectMediaUrl, releaseVideo, waitForMedia, seekPresentedFrame } from "./lifecycle";

const MAX_IMAGE_BYTES = 256 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024;
const MAX_EDGE = 768;

/** Owns temporary decoders/canvas; never moves the editor's visible playhead or media. */
export async function inspectAssistantFrames(
  project: InspectionProject,
  request: FrameRequest,
  { signal }: { signal?: AbortSignal } = {},
): Promise<Extract<NativeObservation, { kind: "frames" }>> {
  signal?.throwIfAborted();
  const scene = inspectionScene(project, request);
  const samples = inspectionFrames(scene, request);
  const [rw, rh] = projectRatio(project.ratio);
  const width = Math.round(MAX_EDGE * rw / Math.max(rw, rh));
  const height = Math.round(MAX_EDGE * rh / Math.max(rw, rh));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot inspect video frames.");
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  let loadedUrl: string | null = null;
  let bytes = 0;
  const frames: Extract<NativeObservation, { kind: "frames" }>["frames"] = [];
  try {
    if (document.fonts) await cancellable(document.fonts.ready, signal);
    for (const sample of samples) {
      signal?.throwIfAborted();
      const { clip, sceneTime, sourceTime } = sample;
      if (clip?.url) {
        const url = projectMediaUrl(clip.url);
        if (url !== loadedUrl) {
          await waitForMedia(video, "loadeddata", () => { video.src = url; video.load(); }, signal);
          loadedUrl = url;
        }
        if (!video.videoWidth || !video.videoHeight || !Number.isFinite(video.duration))
          throw new Error(`Clip ${clip.id} has no decodable video frames.`);
        if (sourceTime == null || sourceTime > video.duration + 0.05)
          throw new Error(`Clip ${clip.id} refers to a frame outside its source video.`);
        const time = Math.min(sourceTime, Math.max(0, video.duration - 0.001));
        if (Math.abs(video.currentTime - time) > 0.001) {
          await seekPresentedFrame(video, time, signal);
        }
      }
      signal?.throwIfAborted();
      drawSceneFrame(context, width, height, { clip, video: clip?.url ? video : null,
        time: sceneTime, sourceTime: sourceTime ?? 0, texts: scene.texts, layers: layerOrder(scene) });
      const dataUrl = canvas.toDataURL("image/jpeg", 0.72);
      bytes += dataUrl.length;
      if (!dataUrl.startsWith("data:image/jpeg;base64,") || dataUrl.length > MAX_IMAGE_BYTES || bytes > MAX_TOTAL_BYTES)
        throw new Error("The inspected frames are too large. Request fewer frames.");
      frames.push({ sceneTime, clipId: clip?.id ?? null, sourceTime, dataUrl, width, height });
    }
    return { kind: "frames", sceneId: scene.id, start: request.start, end: request.end, frames,
      coverage: "video-and-text",
      note: "Sampled footage and native text, with authored crop, zoom, mirror and animation at each timestamp. Interactive PVO components are not included in these images; inspect their project data separately." };
  } finally {
    releaseVideo(video);
    canvas.width = 0;
    canvas.height = 0;
  }
}
