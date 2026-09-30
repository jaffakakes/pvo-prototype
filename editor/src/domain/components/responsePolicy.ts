import type { PvoComponent, ResponsePolicy } from "../project/model";

export const DEFAULT_RESPONSE_POLICY: Readonly<ResponsePolicy> = {
  dispatch: "interaction",
  unanswered: "continue",
};

export function acceptsResponse(component: Pick<PvoComponent, "type">): boolean {
  return component.type !== "tooltip";
}

/** Return the one required response policy for an interactive component. */
export function responsePolicyFor(
  component: Pick<PvoComponent, "type" | "responsePolicy">,
): ResponsePolicy {
  if (!acceptsResponse(component))
    throw new Error("Display-only Notes do not have a response policy.");
  if (component.responsePolicy) return component.responsePolicy;
  throw new Error("Interactive components require a response policy.");
}
