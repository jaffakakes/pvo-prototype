import { create } from "zustand";
import type { AssistantReview } from "../../domain/assistant/review";

export type AssistantPhase = "idle" | "typing" | "listening" | "working" | "review";
type AssistantState = {
  phase: AssistantPhase;
  draft: string;
  transcript: string;
  failureDetail: { operation: string; detail: string } | null;
  review: AssistantReview | null;
  before: boolean;
};
const empty: AssistantState = {
  phase: "idle", draft: "", transcript: "", failureDetail: null, review: null, before: false,
};

// Session-only proposals are deliberately excluded from project persistence/history.
export const useAssistant = create<AssistantState>(() => ({ ...empty }));
export const resetAssistant = () => useAssistant.setState({ ...empty });
