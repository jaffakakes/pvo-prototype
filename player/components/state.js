import { resolveTextTemplate } from "../../packages/pvo-sdk/index.js";

/** Resolve state-bound semantic copy without changing the authored manifest. */
export function componentWithRuntimeState(component, state = {}) {
  if (component.kind !== "tooltip") return component;
  return {
    ...component,
    text: resolveTextTemplate(component.text, { state }),
  };
}
