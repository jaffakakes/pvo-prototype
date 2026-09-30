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
  const policy = component.responsePolicy;
  if (!policy)
    throw new Error("Interactive components require a response policy.");
  if (policy.dispatch !== "interaction" && policy.dispatch !== "layer_end")
    throw new Error("Response dispatch must be interaction or layer_end.");
  if (policy.unanswered !== "continue" && policy.unanswered !== "pause")
    throw new Error("Unanswered playback must be continue or pause.");
  return policy;
}

/** Assert the one current response-policy shape without translating older fields. */
export function assertResponsePolicyContract(
  components: readonly Pick<PvoComponent, "type" | "responsePolicy">[],
): void {
  for (const component of components) {
    if (Object.hasOwn(component, "branchAtEnd"))
      throw new Error("branchAtEnd is not supported; use responsePolicy.");
    if (acceptsResponse(component)) {
      responsePolicyFor(component);
      continue;
    }
    if (component.responsePolicy !== undefined)
      throw new Error("Display-only Notes cannot define a response policy.");
  }
}
