import { dragMusic } from "../../domain/audio/music";
import { useCapture } from "../captureStore";
import {
  projectSnapshot,
  ownsHistory,
  commitGestureHistory,
} from "../project/history";

/** Music uses the same preview/commit/cancel ownership boundary as other layers. */
export function beginMusicTimingDrag(mode: "move" | "l" | "r") {
  const before = useCapture.getState();
  const original = before.music;
  if (
    !original ||
    before.tryMode ||
    before.playheadPick ||
    before.recording ||
    before.ex === "running"
  )
    return null;
  const snapshot = projectSnapshot(before);
  let preview = original;
  let ended = false;
  const owns = () => !ended && ownsHistory(useCapture.getState(), before);
  const active = () =>
    owns() &&
    useCapture.getState().currentSceneId === before.currentSceneId &&
    !useCapture.getState().tryMode &&
    !useCapture.getState().playheadPick &&
    useCapture.getState().music === preview;
  const restore = () => {
    if (!owns()) return;
    const state = useCapture.getState();
    const scene = state.scenes.find(
      (scene) => scene.id === before.currentSceneId,
    );
    if (scene?.music === preview && preview !== original)
      state.updateScene(scene.id, { music: original }, false);
  };
  return {
    update(delta: number) {
      if (!active()) return false;
      preview = dragMusic(original, mode, delta);
      useCapture.getState().patch({ music: preview, playing: false });
      return true;
    },
    commit() {
      if (!active()) {
        restore();
        ended = true;
        return false;
      }
      const changed =
        preview.start !== original.start ||
        preview.duration !== original.duration ||
        preview.offset !== original.offset;
      if (changed)
        commitGestureHistory(useCapture.getState(), before, snapshot);
      ended = true;
      return true;
    },
    cancel() {
      restore();
      ended = true;
    },
  };
}
