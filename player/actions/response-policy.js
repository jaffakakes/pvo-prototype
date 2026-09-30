/** Read the validated response policy required on every interactive component. */
export function responsePolicyFor(component) {
  const policy = component?.response_policy;
  if (!policy || typeof policy !== "object") {
    throw new Error(`Interactive component "${component?.id || "unknown"}" has no response_policy.`);
  }
  return { dispatch: policy.dispatch, unanswered: policy.unanswered };
}

export function needsResponseBoundary(component) {
  if (component?.kind === "tooltip") return false;
  const policy = responsePolicyFor(component);
  return policy.dispatch === "layer_end" || policy.unanswered === "pause";
}

/** Describe the work that must happen when an interactive layer reaches its end. */
export function responseBoundaryWork(component, response) {
  const policy = responsePolicyFor(component);
  if (!response) return policy.unanswered === "pause" ? "wait" : null;
  if (policy.dispatch !== "layer_end") return null;
  return response.status === "captured" ? "dispatch" : null;
}
