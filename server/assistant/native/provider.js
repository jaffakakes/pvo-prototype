import { nativeModelConfiguration } from "./models.js";
import { alignmentConfigured } from "./alignment.js";
import { trackingConfigured } from "./tracking.js";

/** HTTP is an explicit native-only development option, restricted to exact loopback origins. */
export function nativeAssistantOrigin(env, config, requestOrigin) {
  if (config.origin === requestOrigin) return config.origin;
  if (env.ASSISTANT_LOCAL_DEVELOPMENT !== "true") return null;
  try {
    const origin = new URL(env.PUBLIC_ORIGIN);
    if (origin.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname)
      && !origin.username && !origin.password && origin.pathname === "/" && !origin.search && !origin.hash
      && origin.origin === requestOrigin) return origin.origin;
  } catch { /* An invalid development origin never enables inference. */ }
  return null;
}

export function nativeAssistantStatus(env, config, requestOrigin) {
  const model = nativeModelConfiguration(env);
  const available = Boolean(nativeAssistantOrigin(env, config, requestOrigin) && model.available);
  return {
    provider: "open-source", available, model: model.model,
    capabilities: { editing: available, frames: available, transcription: available && model.transcription,
      wordTiming: available && alignmentConfigured(env), objectTracking: available && trackingConfigured(env) },
    // Public SIWC registration supports local clients. Hosted plan access needs
    // OpenAI approval; a normal website identity login does not grant inference.
    chatgpt: {
      available: false, reason: "hosted_access_required",
      message: "ChatGPT plan access for hosted apps is not yet configured.",
      documentationUrl: "https://developers.openai.com/siwc/token-sharing-open-source",
    },
  };
}
