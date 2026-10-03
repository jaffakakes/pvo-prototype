import { AssistantServiceError } from "../../../domain/assistant/failure";

export type VoiceFailure = {
  reason: "holdShort" | "unavailable" | "denied" | "noMicrophone" | "noSpeech" | "network" | "failed";
  detail: string;
  serviceError?: AssistantServiceError;
};

export function voiceFailure(error: unknown): VoiceFailure {
  if (error instanceof AssistantServiceError)
    return { reason: "network", detail: error.message, serviceError: error };
  const name = error instanceof Error ? error.name : "";
  if (["NotAllowedError", "SecurityError"].includes(name)) return { reason: "denied", detail: name };
  if (["NotFoundError", "NotReadableError", "OverconstrainedError"].includes(name)) return { reason: "noMicrophone", detail: name };
  if (name === "NotSupportedError") return { reason: "unavailable", detail: name };
  if (name === "TypeError") return { reason: "network", detail: "Voice transcription could not connect." };
  return { reason: "failed", detail: error instanceof Error ? error.message : "Voice input failed." };
}
