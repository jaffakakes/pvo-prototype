import type { PvoComponent } from "../../domain/project/model";
import { useCapture } from "../captureStore";
import { projectSnapshot } from "../project/history";

type Values = Pick<
  PvoComponent,
  | "opacity"
  | "rotation"
  | "scale"
  | "scaleX"
  | "scaleY"
  | "x"
  | "y"
  | "at"
  | "dur"
>;
const values = (c: PvoComponent): Values => ({
  opacity: c.opacity,
  rotation: c.rotation,
  scale: c.scale,
  scaleX: c.scaleX,
  scaleY: c.scaleY,
  x: c.x,
  y: c.y,
  at: c.at,
  dur: c.dur,
});
const equal = (a: Values, b: Values) =>
  Object.keys(a).every(
    (key) => a[key as keyof Values] === b[key as keyof Values],
  );

/** Live changes own only layer values; a completed gesture contributes one undo entry. */
export function beginComponentLayerGesture(id: string) {
  const before = useCapture.getState();
  const component = before.components.find((item) => item.id === id);
  if (!component || before.tryMode || before.playheadPick) return null;
  const original = values(component);
  const snapshot = projectSnapshot(before);
  let expected = original;
  let ended = false;
  const active = () => {
    const state = useCapture.getState();
    const current = state.components.find((item) => item.id === id);
    return (
      !ended &&
      state.localId === before.localId &&
      state.currentSceneId === before.currentSceneId &&
      state.past === before.past &&
      state.future === before.future &&
      !state.tryMode &&
      !!current &&
      equal(values(current), expected)
    );
  };
  const restore = () => {
    const state = useCapture.getState();
    if (state.localId !== before.localId) return;
    const scene = state.scenes.find(
      (item) => item.id === before.currentSceneId,
    );
    const current = scene?.components.find((item) => item.id === id);
    if (
      !scene ||
      !current ||
      !equal(values(current), expected) ||
      equal(expected, original)
    )
      return;
    state.updateScene(
      scene.id,
      {
        components: scene.components.map((item) =>
          item.id === id ? { ...item, ...original } : item,
        ),
      },
      false,
    );
  };
  return {
    update(changes: Partial<Values>) {
      if (!active()) return false;
      useCapture
        .getState()
        .updateComponent(id, changes, false, { preservePlayhead: true });
      expected = values(
        useCapture.getState().components.find((item) => item.id === id)!,
      );
      return true;
    },
    commit() {
      if (ended) return;
      if (!active()) restore();
      else if (!equal(original, expected)) {
        useCapture
          .getState()
          .patch({ past: [...before.past, snapshot].slice(-40), future: [] });
      }
      ended = true;
    },
    cancel() {
      if (ended) return;
      restore();
      ended = true;
    },
  };
}
