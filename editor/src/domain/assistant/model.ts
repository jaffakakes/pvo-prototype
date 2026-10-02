export type AssistantAnswer = {
  request: string;
  message: string;
  observations: string[];
};

export type AssistantMessage = { role: "user" | "assistant"; content: string };
export type AssistantEvidence = { scope: "audio" | "project"; fingerprint: string; content: string };
