import {
  constrainOverlayPosition,
  overlayPositionFromPixels,
  overlayPositionToPixels,
  type OverlayPosition,
  type OverlayTarget,
} from "../../domain/layers/transform";
import { projectCanvasSize } from "../../domain/project/ratio";
import { useCapture } from "../captureStore";

/** Commit canvas-pixel coordinates through the same bounded position rule as preview dragging. */
export function setOverlayPixelPosition(target: OverlayTarget, changes: Partial<OverlayPosition>) {
  const state = useCapture.getState();
  if (state.tryMode || state.playheadPick) return false;
  const item = target.kind === "text"
    ? state.texts.find(value => value.id === target.id)
    : state.components.find(value => value.id === target.id);
  if (!item) return false;
  const canvas = projectCanvasSize(state.ratio);
  const current = overlayPositionToPixels(item, canvas);
  const requested = {
    x: changes.x ?? current.x,
    y: changes.y ?? current.y,
  };
  if (!Number.isFinite(requested.x) || !Number.isFinite(requested.y)) return false;
  const next = constrainOverlayPosition(overlayPositionFromPixels(requested, canvas));
  if (next.x === item.x && next.y === item.y) return false;
  if (target.kind === "text") state.updateText(target.id, next);
  else state.updateComponent(target.id, next);
  return true;
}
