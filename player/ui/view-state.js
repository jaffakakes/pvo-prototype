/** Derive viewer chrome without changing the component's authored playback rules. */
export function playerViewState(session, { paused, muted }, visibleComponents = []) {
  if (session.finished) return { state: "finished", component: null };
  const active = session.awaitingComponent || visibleComponents.find(component =>
    session.pendingComponents.has(component.id) || session.failedRequestComponents.has(component.id));
  if (active) {
    if (session.pendingComponents.has(active.id)) return { state: "submitting", component: active };
    if (session.failedRequestComponents.has(active.id)
        || session.capturedResponses.get(active.id)?.status === "failed") {
      return { state: "error", component: active };
    }
    if (session.awaitingComponent) return { state: "waiting", component: active };
  }
  return { state: paused ? "paused" : muted ? "autoplay" : "playing", component: null };
}

export function formatDuration(seconds) {
  const value = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  return `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
}
