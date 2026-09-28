import { textStyle } from "../../../../packages/pvo-text-runtime/index.js";
import { componentGestureScale, scaleComponentUniformly } from "../../domain/components/scale";
import { constrainOverlayTransform, type OverlayTarget, type OverlayTransform } from "../../domain/layers/transform";
import { useCapture } from "../captureStore";
import { projectSnapshot } from "../project/history";

/** Preview changes live, then record the complete gesture as one project edit. */
export function beginOverlayTransform(target: OverlayTarget) {
  const before = useCapture.getState();
  const text = target.kind === "text" ? before.texts.find(item => item.id === target.id) : undefined;
  const component = target.kind === "component" ? before.components.find(item => item.id === target.id) : undefined;
  const item = text ?? component;
  if (!item || before.tryMode || before.playheadPick) return null;
  const snapshot = projectSnapshot(before);
  const original = { x: item.x, y: item.y, size: text ? textStyle(text).size : componentGestureScale(component!) };
  const originalSize = component && { scale: component.scale, scaleX: component.scaleX, scaleY: component.scaleY };
  let current = original;
  let ended = false;
  let touched = false;
  const unchangedHistory = () => {
    const state = useCapture.getState();
    return !ended && state.past === before.past && state.future === before.future;
  };
  const active = () => {
    const state = useCapture.getState();
    return unchangedHistory() && state.currentSceneId === before.currentSceneId && (target.kind === "text"
        ? state.texts.some(value => value.id === target.id)
        : state.components.some(value => value.id === target.id));
  };
  const same = (a: OverlayTransform, b: OverlayTransform) => a.x === b.x && a.y === b.y && a.size === b.size;
  const restore = () => {
    if (!touched) return;
    const state = useCapture.getState();
    if (state.currentSceneId !== before.currentSceneId) {
      const scene = state.scenes.find(value => value.id === before.currentSceneId);
      if (!scene) return;
      state.updateScene(scene.id, text ? {
        texts: scene.texts.map(value => value.id === text.id ? { ...value, x: text.x, y: text.y, style: text.style } : value),
      } : {
        components: scene.components.map(value => value.id === component!.id
          ? { ...value, x: component!.x, y: component!.y, ...originalSize } : value),
      }, false);
      return;
    }
    if (text) state.updateText(text.id, { x: text.x, y: text.y, style: text.style }, false);
    if (component) state.updateComponent(component.id, { x: component.x, y: component.y, ...originalSize }, false);
  };

  return {
    value: () => current,
    update(value: OverlayTransform) {
      if (!active()) return false;
      const next = constrainOverlayTransform(target, value);
      const size = component ? scaleComponentUniformly(component, next.size) : null;
      if (size) next.size = size.scale;
      if (same(current, next)) return true;
      touched = true;
      const state = useCapture.getState();
      if (text) state.updateText(text.id, {
        x: next.x, y: next.y,
        ...(next.size !== current.size ? { style: { ...textStyle(text), size: next.size } } : {}),
      }, false);
      if (component) state.updateComponent(component.id, { x: next.x, y: next.y, ...size }, false);
      current = next;
      return true;
    },
    commit() {
      if (!active()) { ended = true; return; }
      if (!same(current, original)) {
        const state = useCapture.getState();
        state.patch({ past: [...state.past, snapshot].slice(-40), future: [] });
      } else restore();
      ended = true;
    },
    cancel() {
      if (unchangedHistory()) restore();
      ended = true;
    },
  };
}
