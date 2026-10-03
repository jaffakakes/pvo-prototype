import type { NativeOperation } from "../../../../../packages/pvo-assistant/native/index.js";
import { validateFontAsset } from "../../../../../packages/pvo-fonts/index.js";
import { DEFAULT_TEXT_STYLE } from "../../../../../packages/pvo-text-runtime/index.js";
import { isVisualEditingBlocked } from "../../components/codeOwnership";
import type { Scene } from "../../project/model";
import type { NativePreparation } from "./types";

export function applyFontOperation(scene: Scene, operation: Extract<NativeOperation, { kind: "font.apply" }>,
  fonts: NativePreparation["fonts"]): Scene {
  const supplied = operation.fontId === null ? undefined : fonts?.get(operation.fontId);
  if (operation.fontId !== null && (!supplied || supplied.id !== operation.fontId))
    throw new Error("Find and save the requested font before applying it.");
  const font = supplied ? validateFontAsset(supplied) : undefined;
  if (operation.target.kind === "component") {
    const original = scene.components.find(item => item.id === operation.target.id);
    if (!original) throw new Error("Choose an existing component for this font.");
    if (isVisualEditingBlocked(original)) throw new Error("Finish or discard the source draft before applying a font.");
    return { ...scene, components: scene.components.map(item => item.id === original.id ? { ...item, font } : item) };
  }
  const original = scene.texts.find(item => item.id === operation.target.id);
  if (!original) throw new Error("Choose an existing text layer for this font.");
  return { ...scene, texts: scene.texts.map(item => item.id === original.id
    ? { ...item, style: { ...DEFAULT_TEXT_STYLE, ...item.style, fontAsset: font } } : item) };
}
