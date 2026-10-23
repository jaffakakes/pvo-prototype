import { componentRotation } from "../../../../packages/pvo-component-runtime/index.js";
import { textStyle } from "../../../../packages/pvo-text-runtime/index.js";
import {
  componentGestureScale,
  scaleComponentUniformly,
} from "../../domain/components/scale";
import {
  constrainOverlayTransform,
  type OverlayTarget,
  type OverlayTransform,
} from "../../domain/layers/transform";
import { useCapture } from "../captureStore";
import {
  projectSnapshot,
  commitGestureHistory,
  ownsHistory,
} from "../project/history";

/** Preview changes live, then record the complete gesture as one project edit. */
export function beginOverlayTransform(target: OverlayTarget) {
  const before = useCapture.getState();
  const text =
    target.kind === "text"
      ? before.texts.find((item) => item.id === target.id)
      : undefined;
  const component =
    target.kind === "component"
      ? before.components.find((item) => item.id === target.id)
      : undefined;
  const item = text ?? component;
  if (!item || before.tryMode || before.playheadPick) return null;
  const snapshot = projectSnapshot(before);
  const original = {
    x: item.x,
    y: item.y,
    size: text ? textStyle(text).size : componentGestureScale(component!),
    rotation: text
      ? textStyle(text).rotation
      : componentRotation(component!.rotation),
  };
  const originalSize = component && {
    scale: component.scale,
    scaleX: component.scaleX,
    scaleY: component.scaleY,
    rotation: component.rotation,
  };
  let current = original;
  let ended = false;
  let touched = false;
  const unchangedHistory = () => {
    const state = useCapture.getState();
    return !ended && ownsHistory(state, before);
  };
  const active = () => {
    const state = useCapture.getState();
    return (
      unchangedHistory() &&
      state.currentSceneId === before.currentSceneId &&
      (target.kind === "text"
        ? state.texts.some((value) => value.id === target.id)
        : state.components.some((value) => value.id === target.id))
    );
  };
  const same = (a: typeof original, b: typeof original) =>
    a.x === b.x &&
    a.y === b.y &&
    a.size === b.size &&
    a.rotation === b.rotation;
  const restore = () => {
    if (!touched) return;
    const state = useCapture.getState();
    if (state.currentSceneId !== before.currentSceneId) {
      const scene = state.scenes.find(
        (value) => value.id === before.currentSceneId,
      );
      if (!scene) return;
      state.updateScene(
        scene.id,
        text
          ? {
              texts: scene.texts.map((value) =>
                value.id === text.id
                  ? { ...value, x: text.x, y: text.y, style: text.style }
                  : value,
              ),
            }
          : {
              components: scene.components.map((value) =>
                value.id === component!.id
                  ? {
                      ...value,
                      x: component!.x,
                      y: component!.y,
                      ...originalSize,
                    }
                  : value,
              ),
            },
        false,
      );
      return;
    }
    if (text)
      state.updateText(
        text.id,
        { x: text.x, y: text.y, style: text.style },
        false,
      );
    if (component)
      state.updateScene(
        before.currentSceneId,
        {
          components: state.components.map((value) =>
            value.id === component.id
              ? { ...value, x: component.x, y: component.y, ...originalSize }
              : value,
          ),
        },
        false,
      );
  };

  return {
    value: () => current,
    update(value: OverlayTransform & { rotation?: number }) {
      if (!active()) return false;
      const next = {
        ...constrainOverlayTransform(target, value),
        rotation: component
          ? componentRotation(value.rotation ?? current.rotation)
          : (value.rotation ?? current.rotation),
      };
      const size = component
        ? scaleComponentUniformly(component, next.size)
        : null;
      if (size) next.size = size.scale;
      if (same(current, next)) return true;
      touched = true;
      const state = useCapture.getState();
      if (text)
        state.updateText(
          text.id,
          {
            x: next.x,
            y: next.y,
            ...(next.size !== current.size || next.rotation !== current.rotation
              ? {
                  style: {
                    ...textStyle(text),
                    size: next.size,
                    rotation: next.rotation,
                  },
                }
              : {}),
          },
          false,
        );
      if (component)
        state.updateComponent(
          component.id,
          {
            x: next.x,
            y: next.y,
            ...size,
            ...(next.rotation !== current.rotation
              ? { rotation: next.rotation }
              : {}),
          },
          false,
        );
      current = next;
      return true;
    },
    commit() {
      if (!active()) {
        ended = true;
        return;
      }
      if (!same(current, original)) {
        const state = useCapture.getState();
        commitGestureHistory(state, before, snapshot);
      } else restore();
      ended = true;
    },
    cancel() {
      if (unchangedHistory()) restore();
      ended = true;
    },
  };
}
