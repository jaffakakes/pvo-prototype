import { DEFAULT_TEXT_STYLE, type TextStyle } from "../../../../packages/pvo-text-runtime/index.js";
import { constrainOverlayPosition } from "../layers/transform";
import type { TextOverlay } from "../project/model";

export function createTextOverlay(id: number, text: string, start: number, style: TextStyle = DEFAULT_TEXT_STYLE): TextOverlay {
  return { id, text, style: { ...style }, color: 2, start: Math.max(0, start), end: Math.max(0, start) + 3, x: 50, y: 45 };
}

export function updateTextOverlay(text: TextOverlay, changes: Partial<TextOverlay>): TextOverlay {
  const next = { ...text, ...changes, id: text.id };
  return "x" in changes || "y" in changes
    ? { ...next, ...constrainOverlayPosition({ x: changes.x ?? text.x, y: changes.y ?? text.y }) }
    : next;
}
