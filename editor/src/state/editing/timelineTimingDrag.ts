import { sceneDuration } from "../../domain/scenes/duration";
import { trimClipHandle } from "../../domain/clips/trim";
import { clamp } from "../../domain/project/numbers";
import { dragTextTiming } from "../../domain/text/timing";
import { useCapture } from "../captureStore";
import { projectSnapshot } from "../project/history";

export type TimelineTimingTarget =
  | { kind: "clip"; id: number; mode: "l" | "r" }
  | { kind: "text"; id: number; mode: "move" | "l" | "r" };

/** A pointer gesture previews timing and records one undo step on release. */
export function beginTimelineTimingDrag(target: TimelineTimingTarget) {
  const before = useCapture.getState();
  const clip =
    target.kind === "clip"
      ? before.clips.find((item) => item.id === target.id)
      : undefined;
  const text =
    target.kind === "text"
      ? before.texts.find((item) => item.id === target.id)
      : undefined;
  if ((!clip && !text) || before.tryMode || before.playheadPick) return null;
  before.patch({ playing: false });
  const snapshot = projectSnapshot(before);
  let ended = false;
  let changed = false;
  const unchangedHistory = () => {
    const state = useCapture.getState();
    return (
      !ended && state.past === before.past && state.future === before.future
    );
  };
  const active = () => {
    const state = useCapture.getState();
    return (
      unchangedHistory() &&
      state.currentSceneId === before.currentSceneId &&
      !state.tryMode &&
      !state.playheadPick &&
      (target.kind === "clip" ? state.clips : state.texts).some(
        (item) => item.id === target.id,
      )
    );
  };
  const restore = () => {
    if (!changed) return;
    const state = useCapture.getState();
    const scene = state.scenes.find(
      (item) => item.id === before.currentSceneId,
    );
    if (!scene) return;
    state.updateScene(
      scene.id,
      clip
        ? {
            clips: scene.clips.map((item) =>
              item.id === clip.id
                ? { ...item, in: clip.in, out: clip.out }
                : item,
            ),
          }
        : {
            texts: scene.texts.map((item) =>
              item.id === text!.id
                ? { ...item, start: text!.start, end: text!.end }
                : item,
            ),
          },
      false,
    );
    if (
      state.currentSceneId === before.currentSceneId &&
      !state.tryMode &&
      !state.playheadPick
    )
      state.patch({ t: before.t });
  };

  return {
    update(delta: number, exact = false) {
      if (!active()) return false;
      const state = useCapture.getState();
      if (clip && target.kind === "clip") {
        const next = trimClipHandle(clip, target.mode, delta, exact);
        changed = next.in !== clip.in || next.out !== clip.out;
        const clips = state.clips.map((item) =>
          item.id === clip.id ? next : item,
        );
        state.patch({
          clips,
          // Keep the magnetic target stationary for the whole preview. If the
          // final video becomes shorter, commit clamps the playhead once.
          t: before.t,
          playing: false,
        });
      }
      if (text && target.kind === "text") {
        const next = dragTextTiming(text, target.mode, delta);
        changed =
          (next.start ?? text.start) !== text.start ||
          (next.end ?? text.end) !== text.end;
        state.updateText(text.id, next, false, { preservePlayhead: true });
      }
      return true;
    },
    commit() {
      if (!active()) {
        if (unchangedHistory()) restore();
        ended = true;
        return;
      }
      if (changed) {
        const state = useCapture.getState();
        state.patch({
          t: clamp(clip ? before.t : state.t, 0, sceneDuration(state)),
          past: [...state.past, snapshot].slice(-40),
          future: [],
        });
      }
      ended = true;
    },
    cancel() {
      if (unchangedHistory()) restore();
      ended = true;
    },
  };
}
