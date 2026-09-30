import { needsResponseBoundary, responseBoundaryWork } from "./response-policy.js";

/** Start one identity-checked component operation in the current viewing context. */
export function beginActionOperation(session, componentId) {
  session.interactionOperations.get(componentId)?.controller.abort();
  const operation = {
    id: ++session.interactionSequence,
    componentId,
    epoch: session.interactionEpoch,
    runtime: session.actionRuntime,
    timeline: session.currentTimeline,
    controller: new AbortController(),
  };
  session.interactionOperations.set(componentId, operation);
  session.pendingComponents.add(componentId);
  return operation;
}

export function actionOperationIsCurrent(session, operation) {
  return Boolean(operation)
    && operation.epoch === session.interactionEpoch
    && operation.runtime === session.actionRuntime
    && operation.timeline === session.currentTimeline
    && session.interactionOperations.get(operation.componentId) === operation;
}

export function finishActionOperation(session, operation) {
  if (!actionOperationIsCurrent(session, operation)) return false;
  session.interactionOperations.delete(operation.componentId);
  session.pendingComponents.delete(operation.componentId);
  return true;
}

/** Invalidate pending work before restart, replacement, seeking, or timeline changes. */
export function invalidateActionOperations(session) {
  const hadOperations = session.interactionOperations.size > 0;
  session.interactionEpoch += 1;
  session.interactionOperations.forEach((operation) => {
    const response = session.capturedResponses.get(operation.componentId);
    if (response?.status === "pending") response.status = "captured";
    operation.controller.abort();
  });
  session.interactionOperations.clear();
  session.pendingComponents.clear();
  return hadOperations;
}

export function clearResponseProgress(session) {
  session.capturedResponses.clear();
  session.handledResponses.clear();
  session.awaitingComponent = null;
}

/** Invalidate every in-flight seek before a restart, replacement, or authored route. */
export function invalidatePlaybackNavigation(session) {
  session.seekSequence += 1;
  session.playbackRouteRevision += 1;
}

function componentBoundaryElapsed(session, component) {
  const presentation = component?.presentation;
  if (!presentation || !Number.isFinite(presentation.end)) return null;
  let before = 0;
  for (const clip of session.currentTimeline?.clips || []) {
    const matches = presentation.clip
      ? presentation.clip === (clip.source_clip || clip.id)
      : presentation.scene === clip.scene;
    if (matches) return session.captureMode
      ? Number(presentation.end)
      : before + Number(presentation.end);
    before += Math.max(0, Number(clip.end) - Number(clip.start));
  }
  return null;
}

/** Keep forward responses, while a rewind re-arms only boundaries at/after the target. */
export function reconcileResponseProgress(session, currentElapsed, targetElapsed, {
  responseBoundaries = "enforce",
  isBoundaryEligible = () => true,
} = {}) {
  session.awaitingComponent = null;
  const rewinding = targetElapsed < currentElapsed - .001;
  const components = (session.manifest?.components || [])
    .map((component) => ({ component, boundary: componentBoundaryElapsed(session, component) }))
    .filter(({ boundary }) => boundary !== null)
    .sort((a, b) => a.boundary - b.boundary);
  for (const { component, boundary } of components) {
    if (rewinding) {
      if (boundary >= targetElapsed - .001) {
        session.capturedResponses.delete(component.id);
        session.handledResponses.delete(component.id);
      }
      continue;
    }
    if (boundary < currentElapsed - .001 || boundary >= targetElapsed - .001
        || !needsResponseBoundary(component) || session.handledResponses.has(component.id)) continue;
    if (responseBoundaries === "skip") {
      session.handledResponses.add(component.id);
      continue;
    }
    if (!isBoundaryEligible(component)) {
      session.handledResponses.add(component.id);
      continue;
    }
    const work = responseBoundaryWork(component, session.capturedResponses.get(component.id));
    session.handledResponses.add(component.id);
    if (work) return [{ componentId: component.id, boundary, work }];
  }
  return [];
}
