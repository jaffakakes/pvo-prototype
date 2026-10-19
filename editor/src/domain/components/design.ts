import { isVisualEditingBlocked } from "./codeOwnership";
import {
  editComponentLook,
  projectComponentLook,
  type LookValuePath,
} from "./languageLook";
import {
  applyComponentPreset,
  type LookPart,
  type LookPreset,
  type LookRadius,
  type LookSize,
  type LookWeight,
  type LookAlign,
} from "./look";
import type { PvoComponent } from "../project/model";

export type DesignEdit =
  | { kind: "background" | "border" | "text"; value: string }
  | { kind: "corners"; value: LookRadius }
  | { kind: "size"; value: LookSize }
  | { kind: "weight"; value: LookWeight }
  | { kind: "align"; value: LookAlign }
  | { kind: "preset"; value: LookPreset };

/** Keep authored rules outside the selected property intact. */
export function editComponentDesign(
  component: PvoComponent,
  part: LookPart,
  edit: DesignEdit,
): Partial<PvoComponent> | null {
  if (isVisualEditingBlocked(component)) return null;
  if (edit.kind === "preset")
    return editComponentLook(
      component,
      applyComponentPreset(component, edit.value),
      { replace: true },
    );
  const look = projectComponentLook(component);
  const index = part.startsWith("button:") ? Number(part.slice(7)) : -1;
  const button = look.btns[index];
  const textPart = part === "heading" ? "heading" : "body";
  const properties: LookValuePath[] = [];
  if (edit.kind === "background" || edit.kind === "border") {
    if (button) {
      const key = edit.kind === "background" ? "fill" : "border";
      button[key] = edit.value;
      properties.push(`btns.${index}.${key}`);
    } else {
      const key = edit.kind === "background" ? "bg" : "border";
      look.whole[key] = edit.value;
      properties.push(`whole.${key}`);
    }
  } else if (edit.kind === "text") {
    if (button) {
      button.text = edit.value;
      properties.push(`btns.${index}.text`);
    } else if (part === "whole") {
      look.whole.text = look.heading.color = look.body.color = edit.value;
      properties.push("whole.text", "heading.color", "body.color");
    } else {
      look[textPart].color = edit.value;
      properties.push(`${textPart}.color`);
    }
  } else if (edit.kind === "corners") {
    if (button) {
      button.radius = edit.value;
      properties.push(`btns.${index}.radius`);
    } else {
      look.whole.radius = edit.value;
      properties.push("whole.radius");
    }
  } else if (edit.kind === "size") {
    if (button) {
      button.size = edit.value;
      properties.push(`btns.${index}.size`);
    } else {
      look[textPart].size = edit.value;
      properties.push(`${textPart}.size`);
    }
  } else if (edit.kind === "weight") {
    if (button) {
      button.weight = edit.value;
      properties.push(`btns.${index}.weight`);
    } else if (part !== "heading") {
      look.body.weight = edit.value;
      properties.push("body.weight");
    }
  } else if (edit.kind === "align" && !button) {
    if (part === "whole") {
      look.whole.align = look.heading.align = look.body.align = edit.value;
      properties.push("whole.align", "heading.align", "body.align");
    } else {
      look[textPart].align = edit.value;
      properties.push(`${textPart}.align`);
    }
  }
  return properties.length
    ? editComponentLook(component, look, { properties })
    : null;
}

export function designColour(
  component: PvoComponent,
  part: LookPart,
  kind: "background" | "border" | "text",
) {
  const look = projectComponentLook(component);
  const button = part.startsWith("button:")
    ? look.btns[Number(part.slice(7))]
    : undefined;
  if (button) return button[kind === "background" ? "fill" : kind];
  if (kind === "background") return look.whole.bg;
  if (kind === "border") return look.whole.border;
  return part === "whole"
    ? look.whole.text
    : look[part === "heading" ? "heading" : "body"].color;
}

export function tintColour(colour: string): string {
  const hex = /^#([a-f\d]{6})$/i.exec(colour)?.[1];
  const value = hex ?? "a78bfa";
  return `rgba(${[0, 2, 4].map((start) => parseInt(value.slice(start, start + 2), 16)).join(", ")}, 0.2)`;
}

/** Recover a tint's hue without changing its alpha or storing extra project state. */
export function solidColour(value: string, fallback = "#a78bfa"): string {
  if (/^#[a-f\d]{6}$/i.test(value)) return value;
  const channels = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,/.exec(value);
  return channels
    ? `#${channels
        .slice(1)
        .map((channel) => Number(channel).toString(16).padStart(2, "0"))
        .join("")}`
    : fallback;
}

export function recolourBackground(current: string, colour: string): string {
  const alpha = /^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\s*\)$/.exec(current)?.[1];
  if (alpha === undefined) return colour;
  return tintColour(colour).replace(/0\.2\)$/, `${alpha})`);
}
