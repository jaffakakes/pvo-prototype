import { HttpError } from "../../http.js";
import { cloudflareNativeModels, NATIVE_TEXT_MODEL } from "./cloudflare.js";
import { runpodNativeModels, RUNPOD_NATIVE_MODEL } from "./runpod.js";
import { runpodTranscriptionConfigured } from "./runpodAudio.js";

/** Select one configured backend. Missing credentials never select another provider. */
export function nativeModelConfiguration(env) {
  const provider = env.ASSISTANT_PROVIDER ?? "cloudflare";
  if (provider === "runpod") return {
    provider, model: RUNPOD_NATIVE_MODEL,
    available: typeof env.RUNPOD_API_KEY === "string" && Boolean(env.RUNPOD_API_KEY.trim()),
    transcription: runpodTranscriptionConfigured(env),
  };
  if (provider === "cloudflare") return {
    provider, model: NATIVE_TEXT_MODEL,
    available: typeof env.AI?.run === "function", transcription: true,
  };
  return { provider, model: "unconfigured", available: false, transcription: false };
}

export function nativeModels(env, options) {
  const configured = nativeModelConfiguration(env);
  if (!configured.available) throw new HttpError(503, "The assistant model is not configured.");
  return configured.provider === "runpod"
    ? runpodNativeModels(env.RUNPOD_API_KEY, options)
    : cloudflareNativeModels(env.AI);
}
