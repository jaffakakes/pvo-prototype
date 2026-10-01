import { total } from "../../domain/clips/timing";
import { componentLength, dragComponentTiming, type ComponentTiming, type TimingDragMode } from "../../domain/components/timing";
import { clamp } from "../../domain/project/numbers";
import { sceneDuration } from "../../domain/scenes/duration";
import { useCapture } from "../captureStore";
import { projectSnapshot } from "../project/history";

/** Preview a timeline drag live, then record the whole gesture as one project edit. */
export function beginComponentTimingDrag(id: string, mode: TimingDragMode) {
  const before = useCapture.getState();
  const component = before.components.find(item => item.id === id);
  if (!component || before.tryMode || before.playheadPick) return null;
  const snapshot = projectSnapshot(before);
  const videoLength = total(before.clips);
  const start = {
    at: component.at,
    dur: component.dur,
    length: componentLength(component, before.clips),
  };
  const original: ComponentTiming = { at: component.at, dur: component.dur };
  let current = original;
  let ended = false;
  let touched = false;
  const same = (a: ComponentTiming, b: ComponentTiming) => a.at === b.at && a.dur === b.dur;
  const unchangedHistory = () => {
    const state = useCapture.getState();
    return !ended && state.past === before.past && state.future === before.future;
  };
  const active = () => {
    const state = useCapture.getState();
    return unchangedHistory() && state.currentSceneId === before.currentSceneId
      && state.components.some(item => item.id === id);
  };
  const restore = () => {
    if (!touched) return;
    const state = useCapture.getState();
    if (state.currentSceneId !== before.currentSceneId) {
      const scene = state.scenes.find(item => item.id === before.currentSceneId);
      if (!scene) return;
      state.updateScene(scene.id, {
        components: scene.components.map(item => item.id === id ? { ...item, ...original } : item),
      }, false);
      return;
    }
    state.updateComponent(id, original, false, { preservePlayhead: true });
  };

  return {
    value: () => current,
    update(delta: number) {
      if (!active()) return false;
      const next = {
        ...current,
        ...dragComponentTiming(start, mode, delta, videoLength),
      };
      if (same(current, next)) return true;
      touched = true;
      useCapture.getState().updateComponent(id, next, false, { preservePlayhead: true });
      current = next;
      return true;
    },
    commit() {
      if (!active()) { ended = true; return; }
      if (!same(current, original)) {
        // Live frames were plain patches; the drop records the pre-drag project once.
        const state = useCapture.getState();
        state.patch({
          t: clamp(state.t, 0, sceneDuration(state)),
          past: [...state.past, snapshot].slice(-40),
          future: [],
        });
      } else restore();
      ended = true;
    },
    cancel() {
      if (unchangedHistory()) restore();
      ended = true;
    },
  };
}
