import type { CompiledPvoComponent } from "../../../../packages/pvo-language/index.js";
import type { AssistantResponse } from "../../../../packages/pvo-assistant/index.js";
export type { AssistantRequest } from "../../../../packages/pvo-assistant/index.js";

export type AssistantMode = "preview" | "connected";

export type AssistantDraft = AssistantResponse;

export type AssistantProposal = AssistantDraft & {
  mode: AssistantMode;
  label: string;
  compiled: Pick<CompiledPvoComponent, "structure" | "rules">;
  skipped?: string[];
};
