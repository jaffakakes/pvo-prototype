import type { Clip, PvoComponent } from "../project/model";
import { componentEnd } from "./timing";

export function componentLabel(component: PvoComponent) {
  const structure = component.code?.custom
    ? component.code.pvoCompiled?.structure
    : null;
  if (structure?.type === "tooltip") return structure.text.trim() || "Tooltip";
  if (structure?.type === "card")
    return structure.title?.trim() || structure.body?.trim() || "Card";
  if (structure?.type === "choice") return structure.prompt.trim() || "Choice";
  if (structure?.type === "form") return structure.submit.trim() || "Form";
  const fields = component.fields;
  if (component.type === "tooltip") return fields.text?.trim() || "Tooltip";
  if (component.type === "card") return fields.title?.trim() || "Card";
  if (component.type === "choice") return fields.prompt?.trim() || "Choice";
  return fields.submitLabel?.trim() || "Form";
}

/** A component shows for its layer, and stays while it waits at the layer end for a response. */
export function componentVisible(
  component: PvoComponent,
  clips: Clip[],
  t: number,
  holdingId: string | null,
) {
  if (holdingId === component.id) return true;
  return t >= component.at && t < componentEnd(component, clips);
}
