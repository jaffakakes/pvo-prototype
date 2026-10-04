import {
  needsResponseBoundary,
  responseBoundaryWork,
} from "../actions/response-policy.js";

/** Return reached response boundaries in authored order without changing response state. */
export function reachedResponseBoundaries(components, handledIds, localTime) {
  return components
    .filter(
      (component) =>
        needsResponseBoundary(component) && !handledIds.has(component.id),
    )
    .sort(
      (a, b) =>
        Number(a.presentation?.end || 0) - Number(b.presentation?.end || 0),
    )
    .filter(
      (component) =>
        localTime >= Number(component.presentation?.end || 0) - 0.04,
    );
}

export function responseBoundaryDecision({
  component,
  response,
  hidden,
  canReceiveResponse,
}) {
  if (hidden || (!response && !canReceiveResponse)) return null;
  return responseBoundaryWork(component, response);
}

/** Decide clip completion independently of media effects and response-boundary ownership. */
export function clipEndTransition({
  clip,
  mediaTime,
  switchingClip,
  finished,
  currentClipIndex,
  clipCount,
  force,
}) {
  if (
    !clip ||
    switchingClip ||
    finished ||
    (!force && mediaTime < clip.end - 0.04)
  )
    return { kind: "none" };
  const next = currentClipIndex + 1;
  return next < clipCount ? { kind: "next", index: next } : { kind: "finish" };
}
