import { parseObjectTrackingResult } from "../../../packages/pvo-assistant/native/index.js";
import { HttpError } from "../../http.js";
import { withAssistantDeadline } from "../deadline.js";
import { parseTrackingInput } from "./trackingInput.js";
import { readTrackingJson } from "./trackingBody.js";

export function trackingConfigured(env) {
  if (typeof env.SAM_TRACKING_TOKEN !== "string" || env.SAM_TRACKING_TOKEN.length < 32) return false;
  try {
    const url = new URL(env.SAM_TRACKING_URL);
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/track") return false;
    if (env.ASSISTANT_LOCAL_DEVELOPMENT === "true" && url.href === "http://127.0.0.1:5199/track") return true;
    return url.protocol === "https:" && !url.port && /^[a-z0-9]+-8000\.proxy\.runpod\.net$/.test(url.hostname);
  } catch { return false; }
}

/** Only the configured authenticated SAM service receives bounded project frames. */
export async function trackNativeObject(env, value, signal, { fetch: send = globalThis.fetch, deadlineMs = 180000 } = {}) {
  if (!trackingConfigured(env)) throw new HttpError(503, "Object tracking is not configured on this server.");
  const input = parseTrackingInput(value);
  return withAssistantDeadline(async activeSignal => {
    let response;
    try {
      response = await send(env.SAM_TRACKING_URL, { method: "POST", redirect: "manual", signal: activeSignal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.SAM_TRACKING_TOKEN}` },
        body: JSON.stringify(input) });
    } catch {
      activeSignal.throwIfAborted();
      throw new HttpError(503, "The object-tracking service is unavailable.");
    }
    if (activeSignal.aborted) {
      await response.body?.cancel().catch(() => {});
      activeSignal.throwIfAborted();
    }
    if (!response.ok) {
      let reason;
      if (response.status === 422) {
        try { reason = (await readTrackingJson(response, 4096, activeSignal))?.code; }
        catch { activeSignal.throwIfAborted(); }
      }
      await response.body?.cancel().catch(() => {});
      if (reason === "ambiguous_target") throw new HttpError(422, "More than one object matches. Point to the object to track.");
      if (reason === "target_not_found") throw new HttpError(422, "No matching object was found. Choose a visible object in the first frame.");
      if (response.status === 409 || response.status === 429) throw new HttpError(429, "Object tracking is busy. Try again shortly.");
      if (response.status === 503) throw new HttpError(503, "The object-tracking service is unavailable.");
      if (response.status === 504) throw new HttpError(504, "Object tracking took too long. Try a shorter range.");
      throw new HttpError(422, "The object could not be tracked. Select a clearer object or a shorter range.");
    }
    try {
      return parseObjectTrackingResult(await readTrackingJson(response, 128 * 1024, activeSignal), {
        width: input.width, height: input.height, times: input.frames.map(frame => frame.time),
      });
    } catch {
      activeSignal.throwIfAborted();
      throw new HttpError(422, "Object tracking returned incomplete measurements. Try a shorter range.");
    }
  }, deadlineMs, signal);
}
