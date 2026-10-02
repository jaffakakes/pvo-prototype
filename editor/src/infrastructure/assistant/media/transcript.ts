import type { NativeObservation } from "../../../../../packages/pvo-assistant/native/index.js";
import type { InspectionProject, TranscriptRequest } from "../../../domain/assistant/mediaInspection";
import { extractAssistantAudio } from "./audio";
import { cancellable } from "./lifecycle";
import { assistantServiceFailure } from "../serviceResponse";

type Transcript = Extract<NativeObservation, { kind: "transcript" }>;

function transcriptResult(value: unknown, request: TranscriptRequest): Pick<Transcript, "text" | "segments"> {
  if (!value || typeof value !== "object" || !("text" in value) || typeof value.text !== "string"
    || value.text.length > 20000 || !("segments" in value) || !Array.isArray(value.segments)
    || value.segments.length > 300)
    throw new Error("The transcription service returned an invalid result.");
  const duration = request.end - request.start;
  const segments = value.segments.map((segment: unknown) => {
    if (!segment || typeof segment !== "object" || !("text" in segment) || typeof segment.text !== "string"
      || segment.text.length > 2000 || !("start" in segment) || typeof segment.start !== "number"
      || !("end" in segment) || typeof segment.end !== "number" || !Number.isFinite(segment.start)
      || !Number.isFinite(segment.end) || segment.start < 0 || segment.start > duration
      || segment.end < segment.start || segment.end > duration + 0.1)
      throw new Error("The transcription service returned invalid timestamps.");
    return { start: request.start + segment.start, end: Math.min(request.end, request.start + segment.end), text: segment.text };
  });
  return { text: value.text, segments };
}

export async function transcribeAssistantAudio(
  project: InspectionProject,
  request: TranscriptRequest,
  { signal, fetch: send = fetch }: { signal?: AbortSignal; fetch?: typeof fetch } = {},
): Promise<Transcript> {
  signal?.throwIfAborted();
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("Audio transcription timed out.")), 95000);
  try {
    const wav = await extractAssistantAudio(project, request, { signal: controller.signal, fetch: send });
    controller.signal.throwIfAborted();
    if (!wav) return { kind: "transcript", sceneId: request.sceneId, start: request.start, end: request.end, text: "", segments: [] };
    const response = await cancellable(send("/api/assistant/transcribe", {
      method: "POST", credentials: "same-origin", redirect: "error", signal: controller.signal,
      headers: { "Content-Type": "audio/wav", Accept: "application/json", "X-Audio-Duration": String(request.end - request.start) },
      body: wav,
    }), controller.signal);
    if (!response.ok) throw await assistantServiceFailure(response, controller.signal);
    const result = transcriptResult(await cancellable(response.json(), controller.signal), request);
    controller.signal.throwIfAborted();
    return { kind: "transcript", sceneId: request.sceneId, start: request.start, end: request.end, ...result };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}
