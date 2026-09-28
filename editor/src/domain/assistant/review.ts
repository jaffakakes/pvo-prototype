import { compiledComponentChanges, componentLanguageSource } from "../components/languageCompilation";
import type { PvoComponent } from "../project/model";
import { cloneComponent } from "../project/snapshot";
import type { AssistantProposal } from "./model";
import { assistantChanges, type AssistantChanges } from "./changes";

export type AssistantReview = {
  original: PvoComponent;
  proposed: PvoComponent;
  proposal: AssistantProposal;
  request: string;
  tags: string[];
  changes: AssistantChanges;
  skipped: string[];
};

export function assistantSource(component: PvoComponent) {
  if (component.code?.custom && !component.code.pvo)
    throw new Error("This component uses retired code. Reset it to Fields or recreate it before using the assistant.");
  return componentLanguageSource(component);
}

export function createAssistantReview(original: PvoComponent, proposal: AssistantProposal, request: string, tags: string[] = [], skipped: string[] = []): AssistantReview {
  const candidate = { ...cloneComponent(original), code: {
    custom: true, pvoTouched: true, pvoLiteral: true, pvo: { ...proposal.source },
  } };
  const proposed = { ...candidate, ...compiledComponentChanges(candidate, proposal.source, structuredClone(proposal.compiled)) };
  return {
    original: cloneComponent(original), request, proposal,
    tags: [...tags], changes: assistantChanges(assistantSource(original), proposal.source),
    skipped: [...new Set([...skipped, ...(proposal.skipped ?? [])])],
    proposed,
  };
}

export function assistantReviewRequest(review: AssistantReview): string {
  return [review.request, ...review.tags].join("; ");
}

/** Review must never overwrite edits made after the request began. */
export function matchesAssistantTarget(original: PvoComponent, current: PvoComponent | undefined): boolean {
  return !!current && JSON.stringify(original) === JSON.stringify(cloneComponent(current));
}
