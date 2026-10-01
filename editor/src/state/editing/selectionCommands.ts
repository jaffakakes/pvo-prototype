import { deleteSelectedAudio, duplicateSelectedAudio, splitSelectedAudio } from "./audioCommands";
import { splitClipAt } from "../../domain/clips/editing";
import {
  selectedSplitTime,
  trimSelectedAtPlayhead,
} from "../../domain/clips/selectionEditing";
import { total } from "../../domain/clips/timing";
import {
  clampComponentStart,
  componentLength,
} from "../../domain/components/timing";
import { clamp } from "../../domain/project/numbers";
import { sceneDuration } from "../../domain/scenes/duration";
import { uid } from "../../infrastructure/ids";
import { useCapture } from "../captureStore";
import { notify } from "../notifications/notificationStore";

export function clearTimelineSelection() {
  useCapture
    .getState()
    .patch({ sel: -1, selComp: null, selText: null, sheet: null });
}

export function undoTimelineEdit(redo = false) {
  const state = useCapture.getState();
  if (state.tryMode) return;
  if (redo) state.redo();
  else state.undo();
  clearTimelineSelection();
}

export function splitSelectedClip() {
  const state = useCapture.getState();
  if (state.tryMode) return;
  if (state.selAudio != null) { splitSelectedAudio(); return; }
  const time = selectedSplitTime(state.clips, state.sel, state.t);
  const result = time == null ? null : splitClipAt(state.clips, time, uid);
  if (!result) {
    notify("splitUnavailable", { scope: "timeline", currentAttempt: true });
    return;
  }
  state.edit({
    clips: result.clips,
    sel: result.selectedIndex,
    playing: false,
  });
}

export function trimSelectionAtPlayhead(side: "l" | "r") {
  const state = useCapture.getState();
  if (state.tryMode) return;
  const result = trimSelectedAtPlayhead(state.clips, state.sel, state.t, side);
  if (!result) {
    notify("splitUnavailable", { scope: "timeline", currentAttempt: true });
    return;
  }
  state.edit({ clips: result.clips, t: result.time, playing: false });
}

export function duplicateTimelineSelection() {
  const state = useCapture.getState();
  if (state.tryMode) return;
  if (state.selAudio != null) { duplicateSelectedAudio(); return; }
  const length = total(state.clips);
  if (state.selComp) {
    const original = state.components.find((item) => item.id === state.selComp);
    if (!original) return;
    const id = state.duplicateComponent(original.id);
    if (id) {
      const at = clampComponentStart(
        original.at + componentLength(original, state.clips),
        original.dur,
        length,
      );
      useCapture.getState().updateComponent(id, { at }, false);
      useCapture.getState().patch({ t: at, playing: false });
    }
    return;
  }
  if (state.selText != null) {
    const original = state.texts.find((item) => item.id === state.selText);
    if (!original) return;
    state.duplicateText(original.id);
    const after = useCapture.getState();
    const duration = original.end - original.start;
    const start = Math.max(0, original.end);
    if (after.selText != null)
      after.updateText(
        after.selText,
        {
          start,
          end: start + duration,
          x: original.x,
          y: original.y,
        },
        false,
      );
    after.patch({ playing: false });
    return;
  }
  const clip = state.clips[state.sel];
  if (!clip) return;
  const clips = [...state.clips];
  clips.splice(state.sel + 1, 0, { ...clip, id: uid() });
  state.edit({ clips, sel: state.sel + 1, playing: false });
}

export function deleteTimelineSelection() {
  const state = useCapture.getState();
  if (state.tryMode) return;
  if (state.selAudio != null) deleteSelectedAudio();
  else if (state.selComp) state.deleteComponent(state.selComp);
  else if (state.selText != null) state.deleteText(state.selText);
  else if (state.sheet === "sound" && state.sound)
    state.edit({ sound: 0, sheet: null });
  else if (state.sel >= 0) {
    const clips = state.clips.filter((_, i) => i !== state.sel);
    state.edit({
      clips,
      sel: -1,
      t: clamp(state.t, 0, sceneDuration({ ...state, clips })),
      playing: false,
    });
  }
}
