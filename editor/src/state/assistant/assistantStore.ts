import type { NativeAttachment } from "../../../../packages/pvo-assistant/native/index.js";
import { create } from "zustand";

import type {
  AssistantAnswer,
  AssistantSuggestions,
  AssistantEvidence,
  AssistantMessage,
} from "../../domain/assistant/model";

export type AssistantPhase =
  "idle" | "typing" | "listening" | "working" | "review";
type AssistantState = {
  recommendations: AssistantSuggestions | null;
  phase: AssistantPhase;
  minimized: boolean;
  draft: string;
  attachments: NativeAttachment[];
  readingAttachments: boolean;
  transcript: string;
  failureDetail: { operation: string; detail: string } | null;
  answer: AssistantAnswer | null;
  progress: string;
  history: AssistantMessage[];
  evidence: AssistantEvidence[];
};
const empty: AssistantState = {
  recommendations: null,
  phase: "idle",
  minimized: false,
  draft: "",
  attachments: [],
  readingAttachments: false,
  transcript: "",
  failureDetail: null,
  answer: null,
  progress: "",
  history: [],
  evidence: [],
};

// Answers and conversation are session-only; edits use the project history.
export const useAssistant = create<AssistantState>(() => ({ ...empty }));
export const resetAssistant = ({
  preserveConversation = false,
}: { preserveConversation?: boolean } = {}) =>
  useAssistant.setState((current) => ({
    ...empty,
    ...(preserveConversation
      ? {
          history: current.history,
          evidence: current.evidence,
          recommendations: current.recommendations,
        }
      : {}),
  }));

export const assistantFocused = (state: AssistantState) =>
  state.phase !== "idle" && !state.minimized;

export function setAssistantMinimized(minimized: boolean) {
  const { phase } = useAssistant.getState();
  useAssistant.setState({
    minimized: minimized && (phase === "working" || phase === "review"),
  });
}
