import { observeDiagnostic, sanitizeDiagnosticValue, snapshotDiagnosticPath } from "./data.js";

let runtimeSequence = 0;

/** Runtime-local observation IDs and bounded capture; no execution or application state. */
export function createRuntimeDiagnostics(handlers) {
  const prefix = `runtime-${++runtimeSequence}`;
  let sequence = 0;
  const enabled = () => typeof handlers.onDiagnostic === "function";
  const identity = value => typeof value === "string" ? value.slice(0, 128) : undefined;
  function emit(type, context = {}, detail = {}) {
    if (!enabled()) return;
    const diagnostic = context.diagnostic || {};
    const source = diagnostic.source;
    const safeSource = source ? {
      part: source.part,
      revision: identity(source.revision),
      ruleId: identity(source.ruleId),
      ...(Number.isSafeInteger(source.line) ? { line: source.line } : {}),
      ...(Number.isSafeInteger(source.column) ? { column: source.column } : {}),
      ...(typeof source.lastValid === "boolean" ? { lastValid: source.lastValid } : {}),
    } : undefined;
    observeDiagnostic(handlers.onDiagnostic, {
      type,
      ...(typeof context.componentId === "string" ? { componentId: identity(context.componentId) } : {}),
      ...(typeof diagnostic.interactionId === "string" ? { interactionId: identity(diagnostic.interactionId) } : {}),
      ...(typeof diagnostic.sceneId === "string" ? { sceneId: identity(diagnostic.sceneId) } : {}),
      ...(typeof diagnostic.actionId === "string" ? { actionId: identity(diagnostic.actionId) } : {}),
      ...(safeSource ? { source: safeSource } : {}),
      ...detail,
    });
  }
  function capture() {
    if (!enabled()) return false;
    try { return handlers.captureDiagnosticBodies?.() === true; }
    catch { return false; }
  }
  function captureStateBefore(path, source) {
    return capture() ? { before: snapshotDiagnosticPath(source, path) } : undefined;
  }
  function responseStatus(response) {
    if (!enabled()) return undefined;
    try {
      const descriptor = Object.getOwnPropertyDescriptor(response, "status");
      let status;
      if (descriptor && Object.hasOwn(descriptor, "value")) status = descriptor.value;
      else if (!descriptor && typeof Response === "function" && response instanceof Response) {
        // Read native metadata without calling an adapter's own status accessor.
        status = Object.getOwnPropertyDescriptor(Response.prototype, "status")?.get?.call(response);
      }
      return Number.isFinite(status) ? status : undefined;
    } catch { return undefined; }
  }
  function state(path, captured, after, context) {
    if (!enabled()) return;
    emit("state.changed", context, {
      path: String(path).slice(0, 160),
      ...(captured ? {
        before: captured.before,
        after: sanitizeDiagnosticValue(after, path),
      } : {}),
    });
  }
  return {
    enabled,
    emit,
    capture,
    captureStateBefore,
    responseStatus,
    state,
    id: kind => `${prefix}-${kind}-${++sequence}`,
    now: () => globalThis.performance?.now?.() ?? Date.now(),
  };
}
