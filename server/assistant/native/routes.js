import { compilePvoComponent } from "../../../packages/pvo-language/worker.js";
import { parseNativeTurnRequest } from "../../../packages/pvo-assistant/native/index.js";
import { checkOrigin, HttpError, json, readJson } from "../../http.js";
import { withAssistantDeadline } from "../deadline.js";
import { nativeAssistantOrigin, nativeAssistantStatus } from "./provider.js";
import { NATIVE_TRANSCRIPTION_MODEL, runNativeModel } from "./cloudflare.js";
import { NativeAssistantError } from "./errors.js";
import { nativeModels } from "./models.js";
import { validateNativeInput } from "./policy.js";
import { nativeAssistantTurn } from "./service.js";
import { parseTranscriptionResult, readTranscriptionAudio } from "./audio.js";
import { transcribeRunpodAudio } from "./runpodAudio.js";
import { alignmentConfigured, alignNativeAudio } from "./alignment.js";
import { trackingConfigured, trackNativeObject } from "./tracking.js";
import { readTrackingJson } from "./trackingBody.js";
import { TRACKING_MAX_REQUEST_BYTES } from "../../../packages/pvo-assistant/native/index.js";
import { reserveAssistantUsage } from "../quota.js";

/** Only curated public classifications cross the HTTP boundary. */
export async function nativeAssistantRoute(request, env, config) {
  try {
    return await routeNativeAssistant(request, env, config);
  } catch (error) {
    if (!(error instanceof NativeAssistantError)) throw error;
    return json({ error: error.message, code: error.code }, error.status);
  }
}

async function routeNativeAssistant(request, env, config) {
  const url = new URL(request.url);
  const status = nativeAssistantStatus(env, config, url.origin);
  if (url.pathname === "/api/assistant/status") {
    if (request.method !== "GET") throw new HttpError(405, "Read assistant status with GET.");
    return json(status);
  }
  if (!["/api/assistant/turn", "/api/assistant/transcribe", "/api/assistant/align", "/api/assistant/track"].includes(url.pathname))
    throw new HttpError(404, "This assistant operation is unavailable.");
  if (request.method !== "POST") throw new HttpError(405, "Send a request from the assistant panel.");
  if (!nativeAssistantOrigin(env, config, url.origin))
    throw new HttpError(503, "The assistant is unavailable. Please try again later.");
  checkOrigin(request, url.origin);
  if (!status.available) throw new HttpError(503, "The assistant is unavailable. Please try again later.");
  if (url.pathname === "/api/assistant/track") {
    if (!status.capabilities.objectTracking) throw new HttpError(503, "Object tracking is not configured on this server.");
    const input = await withAssistantDeadline(signal => readTrackingJson(request, TRACKING_MAX_REQUEST_BYTES, signal), 30000, request.signal);
    await reserveAssistantUsage(request, env);
    return json(await trackNativeObject(env, input, request.signal));
  }
  if (url.pathname === "/api/assistant/align") {
    const input = await readJson(request, 3 * 1024 * 1024);
    await reserveAssistantUsage(request, env);
    return json(await alignNativeAudio(env, input, request.signal));
  }
  if (url.pathname === "/api/assistant/transcribe") {
    if (!status.capabilities.transcription) throw new HttpError(503, "Audio transcription is not configured for this provider.");
    const { audio, duration } = await readTranscriptionAudio(request);
    await reserveAssistantUsage(request, env);
    if (env.ASSISTANT_PROVIDER === "runpod")
      return json(await transcribeRunpodAudio(env, { audio, duration }, request.signal));
    return withAssistantDeadline(async signal => {
      const result = await runNativeModel(env.AI, NATIVE_TRANSCRIPTION_MODEL,
        { audio, task: "transcribe", vad_filter: true, condition_on_previous_text: false }, signal);
      return json(parseTranscriptionResult(result, duration));
    }, 45000, request.signal);
  }
  let input;
  try {
    input = parseNativeTurnRequest(await readJson(request, 3 * 1024 * 1024));
    validateNativeInput(input);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Send a valid project context and assistant request.");
  }
  await reserveAssistantUsage(request, env);
  return json(await nativeAssistantTurn(input, { models: nativeModels(env), signal: request.signal,
    compile: compilePvoComponent,
    animation: request.headers.get("X-Assistant-Animation") === "1",
    objectTracking: trackingConfigured(env) && request.headers.get("X-Assistant-Object-Tracking") === "1",
    wordTiming: alignmentConfigured(env) && request.headers.get("X-Assistant-Word-Timing") === "1" }));
}
