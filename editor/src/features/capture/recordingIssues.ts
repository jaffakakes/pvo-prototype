import { create } from "zustand";
import { useCapture } from "../../state/captureStore";
import { notify, resolveNotification } from "../../state/notifications/notificationStore";

type RecordingIssue = { clipId: number; detail: string };
export const useRecordingIssues = create<{ issues: RecordingIssue[] }>(() => ({ issues: [] }));

export function reportRecordingFailure(clipId: number, detail: string) {
  useRecordingIssues.setState(state => ({ issues: [...state.issues.filter(issue => issue.clipId !== clipId), { clipId, detail }] }));
  notify("recordingFailed", { scope: `recording:${clipId}`, currentAttempt: true });
}

// A replaced/deleted clip no longer needs a warning. Keep its diagnosis in memory
// while Undo can restore it, and reinstate the warning if the failed clip returns.
useCapture.subscribe((state, previous) => {
  if (state.scenes === previous.scenes && state.past === previous.past && state.future === previous.future) return;
  const issues = useRecordingIssues.getState().issues;
  if (!issues.length) return;
  const active = new Set(state.scenes.flatMap(scene => scene.clips.map(clip => clip.id)));
  const retained = new Set([state, ...state.past, ...state.future]
    .flatMap(project => project.scenes.flatMap(scene => scene.clips.map(clip => clip.id))));
  for (const issue of issues) {
    if (active.has(issue.clipId)) notify("recordingFailed", { scope: `recording:${issue.clipId}` });
    else resolveNotification("recordingFailed", `recording:${issue.clipId}`);
  }
  const remaining = issues.filter(issue => retained.has(issue.clipId));
  if (remaining.length !== issues.length) useRecordingIssues.setState({ issues: remaining });
});

export function replaceFailedRecording(clipId: number) {
  const state = useCapture.getState();
  const scene = state.scenes.find(item => item.clips.some(clip => clip.id === clipId));
  if (!scene || state.recording || state.importing) return;
  if (scene.id !== state.currentSceneId) state.switchScene(scene.id);
  useCapture.getState().patch({ replacing: clipId, screen: "camera", sheet: null, sel: -1,
    playing: false, tryMode: null, recordingInto: null });
}
