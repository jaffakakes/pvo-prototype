import { observeDiagnostic } from "../../packages/pvo-sdk/index.js";

/** Optional player diagnostics use shared facts without adding a viewer-facing debug UI. */
export function reportPlayerDiagnostic(session, type, context = {}, detail = {}) {
  observeDiagnostic(session.onDiagnostic, {
    type,
    ...context,
    ...detail,
  });
}

export function beginPlayerDiagnostic(session, component, target) {
  if (typeof session.onDiagnostic !== "function") return undefined;
  const context = {
    componentId: component.id,
    sceneId: component.presentation?.scene,
    interactionId: `${session.diagnosticId}-input-${++session.diagnosticSequence}`,
  };
  reportPlayerDiagnostic(session, "interaction.received", context, { target: String(target) });
  return context;
}
