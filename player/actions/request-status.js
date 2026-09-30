/** Keep the one player status surface aligned with all active component requests. */
export function updateRequestStatus(session, setStatus) {
  if (session.pendingRequestComponents.size) setStatus("Connecting…", false, true);
  else if (session.failedRequestComponents.size) setStatus("Request unavailable", true);
  else setStatus("");
}

/** Discard request feedback when its owning runtime is replaced or detached. */
export function clearRequestStatus(session) {
  session.pendingRequestComponents.clear();
  session.failedRequestComponents.clear();
}

export function clearComponentRequestFailure(session, componentId, setStatus) {
  if (session.failedRequestComponents.delete(componentId))
    updateRequestStatus(session, setStatus);
}

export function markComponentRequestFailure(session, componentId, setStatus) {
  session.failedRequestComponents.add(componentId);
  updateRequestStatus(session, setStatus);
}
