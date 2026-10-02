import { normalizedAlignmentWords, parseWordAlignment } from "../../../packages/pvo-assistant/native/index.js";
import { HttpError, readJson } from "../../http.js";
import { withAssistantDeadline } from "../deadline.js";
import { MAX_AUDIO_BYTES, parseTranscriptionAudio } from "./audio.js";

/** The testing sidecar is deliberately available only through a fixed local route. */
export function alignmentConfigured(env) {
  return env.ASSISTANT_LOCAL_DEVELOPMENT === "true"
    && env.MFA_ALIGNMENT_URL === "http://127.0.0.1:5198/align"
    && typeof env.MFA_ALIGNMENT_TOKEN === "string" && env.MFA_ALIGNMENT_TOKEN.length >= 32;
}

export function parseAlignmentInput(value) {
  const invalid = () => new HttpError(400, "Send a spoken English transcript and up to 60 seconds of source audio.");
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some(key => !["audio", "duration", "text", "language"].includes(key))
    || typeof value.audio !== "string" || !value.audio.length
    || value.audio.length > Math.ceil(MAX_AUDIO_BYTES / 3) * 4
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.audio)
    || typeof value.text !== "string" || !value.text.trim() || value.text.length > 4000
    || value.language !== "en" || !Number.isFinite(value.duration)) throw invalid();
  const words = normalizedAlignmentWords(value.text);
  if (!words.length || words.length > 300) throw invalid();
  const binary = atob(value.audio);
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  const { duration } = parseTranscriptionAudio(bytes);
  if (Math.abs(value.duration - duration) > 0.0001) throw invalid();
  return { audio: value.audio, duration, text: value.text, language: "en" };
}

export async function alignNativeAudio(env, value, signal, { fetch: send = globalThis.fetch, deadlineMs = 120000 } = {}) {
  if (!alignmentConfigured(env)) throw new HttpError(503, "Word timing is not configured on this server.");
  const input = parseAlignmentInput(value);
  return withAssistantDeadline(async activeSignal => {
    let response;
    try {
      response = await send(env.MFA_ALIGNMENT_URL, {
        method: "POST", redirect: "manual", signal: activeSignal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.MFA_ALIGNMENT_TOKEN}` },
        body: JSON.stringify(input),
      });
    } catch (error) {
      activeSignal.throwIfAborted();
      throw new HttpError(503, "The local word-timing service is unavailable.");
    }
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 503) throw new HttpError(503, "The local word-timing service is unavailable.");
      if (response.status === 504) throw new HttpError(504, "Word timing took too long. Try a shorter range.");
      throw new HttpError(response.status === 429 ? 429 : 422, response.status === 429
        ? "Word timing is busy. Try again shortly."
        : "The speech could not be aligned. Check its transcript and source range.");
    }
    try {
      return parseWordAlignment(await readJson(response, 128 * 1024), input);
    } catch (error) {
      activeSignal.throwIfAborted();
      throw new HttpError(422, "Word timing was incomplete. Check its transcript and source range.");
    }
  }, deadlineMs, signal);
}
