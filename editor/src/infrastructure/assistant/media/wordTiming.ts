import { normalizedAlignmentWords, parseWordAlignment } from "../../../../../packages/pvo-assistant/native/index.js";
import type { InspectionProject } from "../../../domain/assistant/mediaInspection";
import { inspectionWordTiming, mapAlignedWords, type WordTimingObservation, type WordTimingRequest } from "../../../domain/assistant/wordTiming";
import { assistantServiceFailure, readAssistantJson } from "../serviceResponse";
import { cancellable } from "./lifecycle";
import { extractWordTimingAudio } from "./wordAudio";

function audioBase64(wav: ArrayBuffer): string {
  const bytes = new Uint8Array(wav);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}

export async function alignAssistantWords(
  project: InspectionProject,
  request: WordTimingRequest,
  { signal, fetch: send = fetch }: { signal?: AbortSignal; fetch?: typeof fetch } = {},
): Promise<WordTimingObservation> {
  signal?.throwIfAborted();
  if (request.language !== "en" || typeof request.text !== "string" || request.text.length > 4000)
    throw new Error("Word timing requires an English transcript of at most 4000 characters.");
  const words = normalizedAlignmentWords(request.text);
  if (!words.length || words.length > 300) throw new Error("Word timing requires between 1 and 300 supplied transcript words.");
  const source = inspectionWordTiming(project, request);
  const duration = source.sourceEnd - source.sourceStart;
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => controller.abort(new Error("Word alignment timed out.")), 125000);
  try {
    const wav = await extractWordTimingAudio(source, { signal: controller.signal, fetch: send });
    controller.signal.throwIfAborted();
    const response = await cancellable(send("/api/assistant/align", {
      method: "POST", credentials: "same-origin", redirect: "error", signal: controller.signal,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ audio: audioBase64(wav), duration, text: request.text, language: request.language }),
    }), controller.signal);
    if (!response.ok) throw await assistantServiceFailure(response, controller.signal);
    const result = parseWordAlignment(await readAssistantJson(response, controller.signal), { text: request.text, duration });
    controller.signal.throwIfAborted();
    return { kind: "word_timing", sceneId: request.sceneId, start: request.start, end: request.end,
      source: { ...request.source }, sourceStart: source.sourceStart, sourceEnd: source.sourceEnd,
      text: result.text, words: mapAlignedWords(source, result.words), provenance: result.provenance };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}
