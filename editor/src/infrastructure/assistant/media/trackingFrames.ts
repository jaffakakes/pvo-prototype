import { TRACKING_MAX_EDGE, TRACKING_MAX_FRAME_BYTES, TRACKING_MAX_REQUEST_BYTES } from "../../../../../packages/pvo-assistant/native/index.js";
import { trackingInspection, type ObjectTrackingRequest } from "../../../domain/assistant/trackingInspection";
import type { InspectionProject } from "../../../domain/assistant/mediaInspection";
import { projectRatio } from "../../../domain/project/ratio";
import { drawSceneFrame } from "../../media/drawSceneFrame";
import { projectMediaUrl, releaseVideo, seekPresentedFrame, waitForMedia } from "./lifecycle";

export type TrackingFrames = {
  width: number;
  height: number;
  frames: { time: number; imageDataUrl: string }[];
};

/** Independent decoder follows the rendered video transform without text/component overlays. */
async function captureVideoFrames(project: InspectionProject, request: ObjectTrackingRequest, signal?: AbortSignal, firstOnly = false): Promise<TrackingFrames> {
  signal?.throwIfAborted();
  const { clip, samples } = trackingInspection(project, request);
  const [rw, rh] = projectRatio(project.ratio);
  const width = Math.round(TRACKING_MAX_EDGE * rw / Math.max(rw, rh));
  const height = Math.round(TRACKING_MAX_EDGE * rh / Math.max(rw, rh));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot capture tracking frames.");
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  const frames: TrackingFrames["frames"] = [];
  let totalBytes = 0;
  try {
    const source = projectMediaUrl(clip.url!);
    await waitForMedia(video, "loadeddata", () => { video.src = source; video.load(); }, signal);
    if (!video.videoWidth || !video.videoHeight || !Number.isFinite(video.duration))
      throw new Error("The tracking source has no decodable video frames.");
    for (const sample of firstOnly ? samples.slice(0, 1) : samples) {
      signal?.throwIfAborted();
      if (sample.sourceTime > video.duration + .05) throw new Error("The tracking range exceeds its source video.");
      const sourceTime = Math.min(sample.sourceTime, Math.max(0, video.duration - .001));
      if (Math.abs(video.currentTime - sourceTime) > .000001) await seekPresentedFrame(video, sourceTime, signal);
      signal?.throwIfAborted();
      drawSceneFrame(context, width, height, { clip, video, sourceTime: sample.sourceTime,
        time: sample.time, texts: [], layers: ["video"], includeText: false, includeVideoAnimation: true });
      const imageDataUrl = canvas.toDataURL("image/jpeg", .68);
      totalBytes += imageDataUrl.length;
      if (!imageDataUrl.startsWith("data:image/jpeg;base64,") || imageDataUrl.length > TRACKING_MAX_FRAME_BYTES
        || totalBytes > TRACKING_MAX_REQUEST_BYTES - 128 * 1024)
        throw new Error("Tracking frames are too large. Choose a shorter range.");
      frames.push({ time: sample.time, imageDataUrl });
    }
    return { width, height, frames };
  } finally {
    releaseVideo(video);
    canvas.width = 0;
    canvas.height = 0;
  }
}

export function captureTrackingFrames(project: InspectionProject, request: ObjectTrackingRequest, signal?: AbortSignal): Promise<TrackingFrames> {
  return captureVideoFrames(project, request, signal);
}

/** Point selection displays precisely the first canvas image sent to the tracker. */
export async function captureTrackingFrame(project: InspectionProject, request: ObjectTrackingRequest, { signal }: { signal?: AbortSignal } = {}) {
  const result = await captureVideoFrames(project, request, signal, true);
  return { dataUrl: result.frames[0].imageDataUrl, width: result.width, height: result.height };
}
