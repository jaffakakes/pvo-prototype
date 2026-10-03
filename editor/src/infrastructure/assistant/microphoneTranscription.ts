import { AssistantServiceError } from "../../domain/assistant/failure";
import { assistantServiceFailure, readAssistantJson } from "./serviceResponse";
import { cancellable } from "./media/lifecycle";
import { monoWav } from "./media/wav";
import { MAX_MICROPHONE_SECONDS } from "./microphoneCapture";
import { readNativeAvailability } from "./nativeTransport";

const SAMPLE_RATE = 16000;

export async function requireMicrophoneTranscription(signal: AbortSignal): Promise<void> {
  const status = await readNativeAvailability(signal);
  signal.throwIfAborted();
  if (!status.available || !status.capabilities.transcription) throw new AssistantServiceError(503);
}

/** Offline decoding needs no playback context or user-activation-dependent resume. */
export async function microphoneWav(recording: Blob, signal: AbortSignal): Promise<{ wav: ArrayBuffer; duration: number } | null> {
  signal.throwIfAborted();
  if (!recording.size) return null;
  const decoder = new OfflineAudioContext(1, 1, SAMPLE_RATE);
  const encoded = await cancellable(recording.arrayBuffer(), signal);
  const decoded = await cancellable(decoder.decodeAudioData(encoded), signal);
  signal.throwIfAborted();
  const length = Math.min(decoded.length, MAX_MICROPHONE_SECONDS * SAMPLE_RATE);
  if (!length) return null;
  const rendering = new OfflineAudioContext(1, length, SAMPLE_RATE);
  const source = rendering.createBufferSource();
  try {
    source.buffer = decoded;
    source.connect(rendering.destination);
    source.start();
    const mixed = await cancellable(rendering.startRendering(), signal);
    signal.throwIfAborted();
    const samples = mixed.getChannelData(0);
    // Do not ask a speech model to invent words for a silent/empty recording.
    if (!samples.some(sample => Math.abs(sample) > 0.001)) return null;
    return { wav: monoWav(samples, SAMPLE_RATE), duration: length / SAMPLE_RATE };
  } finally {
    source.stop();
    source.disconnect();
    source.buffer = null;
  }
}

/** Upload only an explicitly submitted recording through the existing bounded route. */
export async function transcribeMicrophone(recording: Blob, signal: AbortSignal, send = fetch): Promise<string> {
  signal.throwIfAborted();
  const controller = new AbortController();
  const cancel = () => controller.abort(signal.reason);
  signal.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => controller.abort(new AssistantServiceError(504)), 95000);
  try {
    const audio = await microphoneWav(recording, controller.signal);
    if (!audio) return "";
    controller.signal.throwIfAborted();
    const response = await cancellable(send("/api/assistant/transcribe", {
      method: "POST", credentials: "same-origin", redirect: "error", signal: controller.signal,
      headers: { "Content-Type": "audio/wav", Accept: "application/json", "X-Audio-Duration": String(audio.duration) },
      body: audio.wav,
    }), controller.signal);
    if (!response.ok) throw await assistantServiceFailure(response, controller.signal);
    const result = await readAssistantJson(response, controller.signal, 128 * 1024);
    if (!result || typeof result !== "object" || !("text" in result) || typeof result.text !== "string"
      || result.text.length > 2000) throw new AssistantServiceError(422, undefined, "model_output_invalid");
    controller.signal.throwIfAborted();
    return result.text.trim();
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
  }
}
