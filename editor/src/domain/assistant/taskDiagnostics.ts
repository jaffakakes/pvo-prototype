export type AssistantTaskFailure =
  | "project_changed" | "mixed_tools" | "inspection_limit" | "repeated_inspection"
  | "ask_mode_edit" | "repeated_edit" | "step_limit";

export class AssistantTaskError extends Error {
  constructor(readonly reason: AssistantTaskFailure, message: string) {
    super(message);
    this.name = "AssistantTaskError";
  }
}

/** Diagnostic metadata only: never include prompts, object content, URLs or media. */
export type AssistantTaskTrace = {
  stage: "request" | "model" | "observation" | "preparation" | "application";
  status: "started" | "completed" | "failed" | "cancelled";
  round?: number;
  tools?: string[];
  changed?: boolean;
  reason?: string;
};
