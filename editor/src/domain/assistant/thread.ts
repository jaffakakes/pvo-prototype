import type { AssistantReview } from "./review";
import type { AssistantThreadPatch } from "./threadPatch";

export type AssistantThreadTarget = { sceneId: string; componentId: string };
export type AssistantExchangeStatus = "pending" | "proposed" | "applied" | "failed" | "cancelled";
export type AssistantExchange = {
  id: string;
  at: number;
  kind: "ask" | "suggestion";
  you: string;
  label?: string;
  color?: string;
  orb: string;
  changes: { label: string; tone: "ok" | "warn" }[];
  status: AssistantExchangeStatus;
  pending: boolean;
  undone: boolean;
  targets: AssistantThreadTarget[];
  error?: string;
  patch?: AssistantThreadPatch;
};

export type AssistantExchangeInput = {
  request: string;
  at: number;
  target?: AssistantThreadTarget;
  kind?: "ask" | "suggestion";
  label?: string;
  color?: string;
};

export function assistantExchangeResult(review: AssistantReview): Pick<AssistantExchange, "orb" | "changes"> {
  const changes: AssistantExchange["changes"] = [];
  if (review.changes.structure) changes.push({ label: "Content updated", tone: "ok" });
  if (review.changes.style) changes.push({ label: "Style updated", tone: "ok" });
  if (review.changes.logic) changes.push({ label: "Behavior updated", tone: "ok" });
  changes.push(...review.skipped.map(label => ({ label, tone: "warn" as const })));
  return { orb: review.proposal.summary, changes };
}
