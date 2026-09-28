import { createLook, LOOK_NAMES, type ComponentLook, type LookPreset } from "../../../../packages/pvo-component-runtime/index.js";
import type { PvoComponent } from "../project/model";
import { projectComponentLook } from "./languageLook";

export { createLook, cloneLook, normalizeHex, LOOK_PALETTE, LOOK_PRESETS, LOOK_SIZES } from "../../../../packages/pvo-component-runtime/index.js";
export type { ComponentLook, LookPreset, LookSize, LookAlign, LookRadius, LookWeight, ButtonLook } from "../../../../packages/pvo-component-runtime/index.js";
export type LookPart = "whole" | "heading" | "body" | `button:${number}`;

export function componentButtonCount(component: Pick<PvoComponent, "type" | "fields">): number {
  return component.type === "choice" ? 2 : component.type === "card" ? Math.min(component.fields.buttons?.length ?? 0, 2) : component.type === "form" ? 1 : 0;
}
export function componentLook(component: PvoComponent): ComponentLook {
  return projectComponentLook(component);
}
export function applyComponentPreset(component: PvoComponent, preset: LookPreset): ComponentLook {
  return createLook(preset, componentButtonCount(component));
}
export function resetComponentLook(component: PvoComponent): ComponentLook {
  return applyComponentPreset(component, componentLook(component).basePreset);
}
export function lookPresetName(preset: ComponentLook["preset"]): string { return LOOK_NAMES[preset]; }

export function lookParts(component: PvoComponent): { id: LookPart; label: string }[] {
  const { type, fields } = component;
  const parts: { id: LookPart; label: string }[] = [{ id: "whole", label: "Whole" }];
  if (type !== "tooltip") parts.push({ id: "heading", label: type === "card" ? "Title" : "Heading" });
  if (type !== "choice") parts.push({ id: "body", label: type === "tooltip" ? "Text" : type === "form" ? "Fields" : "Body" });
  for (let index = 0; index < componentButtonCount(component); index++) {
    const label = type === "choice" ? fields.options?.[index]?.label : type === "card" ? fields.buttons?.[index]?.label : fields.submitLabel;
    parts.push({ id: `button:${index}`, label: label || (type === "form" ? "Submit" : `Button ${index + 1}`) });
  }
  return parts;
}
