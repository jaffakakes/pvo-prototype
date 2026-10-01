import { sanitizeDiagnosticText } from "../../../../packages/pvo-sdk/index.js";
import { fieldsShownFor } from "../components/fields";
import { resolveLanguageSource } from "../components/languageCompilation";
import { componentEnd } from "../components/timing";
import { layerOrder } from "../layers/order";
import type { PvoComponent, Scene } from "../project/model";
import type { DebugComponent } from "./types";

export function sourceRevision(component: PvoComponent, currentDraft = false): string {
  const code = component.code;
  const source = code?.custom
    ? currentDraft ? code.pvo : code.pvoTouched && code.pvoLastValid ? code.pvoLastValid : code.pvo
    : component.fields;
  const text = JSON.stringify({ source: code?.custom && source && "structure" in source
    ? resolveLanguageSource(component, source) : source, responsePolicy: component.responsePolicy });
  let hash = 2166136261;
  for (const character of text ?? "") hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `r${(hash >>> 0).toString(16)}`;
}

export function debugComponentName(component: PvoComponent): string {
  const fields = fieldsShownFor(component);
  const label = component.type === "choice" ? fields.prompt : component.type === "card"
    ? fields.title || fields.body : component.type === "form" ? fields.heading || fields.submitLabel : fields.text;
  return sanitizeDiagnosticText(label?.trim() || ({ choice: "Question", card: "Message", form: "Form", tooltip: "Note" }[component.type])).slice(0, 100);
}

export function debugTarget(component: PvoComponent, index: number): string {
  const fields = fieldsShownFor(component);
  return sanitizeDiagnosticText(component.type === "form" ? fields.submitLabel || "Submit"
    : component.type === "choice" ? fields.options?.[index]?.label || `Answer ${index + 1}`
      : fields.buttons?.[index]?.label || `Button ${index + 1}`).slice(0, 100);
}

export function snapshotDebugComponents(scenes: readonly Scene[]): DebugComponent[] {
  return scenes.flatMap(scene => {
    const order = layerOrder(scene);
    return scene.components.map(component => {
      const code = !!component.code?.custom;
      const hasAction = component.type === "tooltip" || !code || !!component.code?.pvoCompiled?.rules.length;
      return {
        id: component.id, name: debugComponentName(component), type: component.type,
        sceneId: scene.id, sceneName: sanitizeDiagnosticText(scene.name).slice(0, 100),
        at: component.at, end: componentEnd(component, scene.clips),
        dispatch: component.responsePolicy?.dispatch ?? null,
        unanswered: component.responsePolicy?.unanswered ?? null,
        hasAction, actionKnown: !code || !!component.code?.pvoCompiled, handled: false, dispatched: false, code,
        source: { revision: sourceRevision(component), lastValid: !!(code && component.code?.pvoTouched && component.code.pvoLastValid) },
        currentRevision: sourceRevision(component, true),
        layer: order.indexOf(`component:${component.id}`) + 1, layerCount: order.length,
        aboveVideo: order.indexOf(`component:${component.id}`) > order.indexOf("video"),
        ready: !code, unavailable: code && !component.code?.pvo,
      };
    });
  });
}
