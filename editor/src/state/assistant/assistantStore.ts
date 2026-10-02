import { create } from "zustand";

import type { AssistantAnswer, AssistantEvidence, AssistantMessage } from "../../domain/assistant/model";

export type AssistantPhase = "idle" | "typing" | "listening" | "working" | "review";
type AssistantState = {
  phase: AssistantPhase;
  draft: string;
  transcript: string;
  failureDetail: { operation: string; detail: string } | null;
  answer: AssistantAnswer | null;
  progress: string;
  history: AssistantMessage[];
  evidence: AssistantEvidence[];
};
const empty: AssistantState = {
  phase: "idle", draft: "", transcript: "", failureDetail: null,
  answer: null, progress: "", history: [], evidence: [],
};

// Answers and conversation are session-only; edits use the project history.
export const useAssistant = create<AssistantState>(() => ({ ...empty }));
export const resetAssistant = ({ preserveConversation = false }: { preserveConversation?: boolean } = {}) =>
  useAssistant.setState(current => ({ ...empty,
    ...(preserveConversation ? { history: current.history, evidence: current.evidence } : {}) }));
