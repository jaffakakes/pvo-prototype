import { parseObjectTrackingResult, type NativeObjectTrackingObservation } from "../../../../../packages/pvo-assistant/native/index.js";
import type { InspectionProject } from "../../../domain/assistant/mediaInspection";
import { trackingInspection, type ObjectTrackingRequest } from "../../../domain/assistant/trackingInspection";
import { assistantServiceFailure, readAssistantJson } from "../serviceResponse";
import { cancellable } from "./lifecycle";
import { captureTrackingFrames, type TrackingFrames } from "./trackingFrames";

export class TrackingSelectionError extends Error {
  constructor(reason: "ambiguous" | "missing" = "ambiguous") {
    super(reason === "ambiguous" ? "More than one object matches. Point to the object to track."
      : "No matching object was found. Choose a visible object in the first frame.");
  }
}

export async function trackAssistantObject(project: InspectionProject, request: ObjectTrackingRequest, {
  signal, fetch: send = fetch, capture = captureTrackingFrames, deadlineMs = 230000,
}: {
  signal?: AbortSignal;
  fetch?: typeof fetch;
  capture?: (project: InspectionProject, request: ObjectTrackingRequest, signal?: AbortSignal) => Promise<TrackingFrames>;
  deadlineMs?: number;
} = {}): Promise<NativeObjectTrackingObservation> {
  signal?.throwIfAborted();
  const { samples } = trackingInspection(project, request);
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("Object tracking timed out. Try a shorter range.")), deadlineMs);
  try {
    const input = await cancellable(capture(project, request, controller.signal), controller.signal);
    controller.signal.throwIfAborted();
    const response = await cancellable(send("/api/assistant/track", {
      method: "POST", credentials: "same-origin", redirect: "error", signal: controller.signal,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ sceneId: request.sceneId, clipId: request.clipId, start: request.start, end: request.end,
        target: request.target, ...input }),
    }).then(response => {
      if (controller.signal.aborted) {
        void response.body?.cancel().catch(() => {});
        controller.signal.throwIfAborted();
      }
      return response;
    }), controller.signal);
    if (!response.ok) {
      if (response.status === 422) {
        const result = await readAssistantJson(response, controller.signal, 4096) as { error?: string };
        if (result?.error === "More than one object matches. Point to the object to track.") throw new TrackingSelectionError();
        if (result?.error === "No matching object was found. Choose a visible object in the first frame.") throw new TrackingSelectionError("missing");
        throw new Error("The object could not be tracked. Select a clearer object or a shorter range.");
      }
      throw await assistantServiceFailure(response, controller.signal);
    }
    const result = parseObjectTrackingResult(await readAssistantJson(response, controller.signal, 128 * 1024), {
      width: input.width, height: input.height, times: samples.map(sample => sample.time),
    });
    controller.signal.throwIfAborted();
    return { id: crypto.randomUUID(), kind: "object_tracking", sceneId: request.sceneId, clipId: request.clipId,
      start: request.start, end: request.end, model: result.model, samples: result.frames, frameCount: result.frames.length };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}
