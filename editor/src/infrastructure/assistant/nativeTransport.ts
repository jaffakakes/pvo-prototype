import { parseNativeTurnResult, type NativeTurnRequest } from "../../../../packages/pvo-assistant/native/index.js";
import { AssistantServiceError } from "../../domain/assistant/failure";
import { assistantServiceFailure, readAssistantJson } from "./serviceResponse";

export type NativeAvailability = {
  provider: "open-source";
  available: boolean;
  model: string;
  capabilities: { editing: boolean; frames: boolean; transcription: boolean; wordTiming: boolean; objectTracking: boolean };
  chatgpt: { available: false; reason: string; message: string; documentationUrl: string };
};

/** Native routes use same-origin cookies only; provider credentials never enter the editor. */
async function nativeRequest(path: string, body: unknown, signal: AbortSignal) {
  signal.throwIfAborted();
  const timeout = AbortSignal.timeout(95000);
  const combined = AbortSignal.any([signal, timeout]);
  try {
    const response = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      headers: { Accept: "application/json", ...(body === undefined ? {} : {
        "Content-Type": "application/json", "X-Assistant-Word-Timing": "1", "X-Assistant-Animation": "1",
        "X-Assistant-Object-Tracking": "1",
      }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin", redirect: "error", signal: combined,
    });
    if (!response.ok) throw await assistantServiceFailure(response, combined);
    return await readAssistantJson(response, combined);
  } catch (error) {
    signal.throwIfAborted();
    if (timeout.aborted) throw new AssistantServiceError(504);
    throw error;
  }
}

export async function requestNativeTurn(request: NativeTurnRequest, signal: AbortSignal) {
  const response = await nativeRequest("/api/assistant/turn", request, signal);
  try { return parseNativeTurnResult(response); }
  catch { throw new AssistantServiceError(422, undefined, "model_output_invalid"); }
}

export async function readNativeAvailability(signal: AbortSignal): Promise<NativeAvailability> {
  const value = await nativeRequest("/api/assistant/status", undefined, signal);
  if (!value || typeof value !== "object") throw new Error("Invalid assistant availability.");
  const status = value as Partial<NativeAvailability>;
  if (status.provider !== "open-source" || typeof status.available !== "boolean" || typeof status.model !== "string"
    || typeof status.capabilities?.editing !== "boolean" || typeof status.capabilities.frames !== "boolean"
    || typeof status.capabilities.transcription !== "boolean" || typeof status.capabilities.wordTiming !== "boolean"
    || typeof status.capabilities.objectTracking !== "boolean"
    || status.chatgpt?.available !== false
    || status.chatgpt.reason !== "hosted_access_required" || typeof status.chatgpt.message !== "string"
    || status.chatgpt.documentationUrl !== "https://developers.openai.com/siwc/token-sharing-open-source") throw new Error("Invalid assistant availability.");
  return status as NativeAvailability;
}
