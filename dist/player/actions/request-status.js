import { describeRequestFailure } from "../../packages/pvo-sdk/index.js";

/** Keep the one player status surface aligned with all active component requests. */
export function updateRequestStatus(session, setStatus) {
  if (session.pendingRequestComponents.size) setStatus("Connecting…", false, true);
  else if (session.failedRequestComponents.size) {
    const failures = [...session.failedRequestComponents.values()];
    setStatus((failures.at(-1) ?? describeRequestFailure(null)).message, true);
  }
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
  if (!session.failedRequestComponents.has(componentId))
    session.failedRequestComponents.set(componentId, describeRequestFailure(null));
  updateRequestStatus(session, setStatus);
}
