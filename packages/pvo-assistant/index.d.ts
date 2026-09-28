export type AssistantSource = { structure: string; style: string; logic: string };
export type AssistantContext = {
  currentSceneId: string;
  duration: number;
  scenes: { id: string; name: string }[];
};
export type AssistantRequest = {
  componentType: "tooltip" | "card" | "choice" | "form";
  source: AssistantSource;
  prompt: string;
  editingMode?: "no-code" | "advanced";
  context?: AssistantContext;
};
export type AssistantResponse = {
  requiresAdvancedLogic?: boolean;
  source: AssistantSource;
  summary: string;
  tags: string[];
  followUps: [string, string, string];
};

export const ASSISTANT_SOURCE_MAX_BYTES: 20000;
export const ASSISTANT_MAX_SCENES: 100;
export const assistantResponseSchema: Readonly<Record<string, unknown>>;
export function parseAssistantRequest(value: unknown): AssistantRequest;
export function parseAssistantResponse(value: unknown): AssistantResponse;
