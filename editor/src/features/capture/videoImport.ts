import { create } from "zustand";
import { total } from "../../domain/clips/timing";
import { round2 } from "../../domain/project/numbers";
import { useCapture } from "../../state/captureStore";
import { mkClip } from "../../state/editing/clipFactory";
import { readVideoMetadata } from "../../infrastructure/media/readVideo";
import { notify, resolveNotification, useNotifications } from "../../state/notifications/notificationStore";

type ImportResult = { failed: File[]; imported: number };
export const useVideoImportStatus = create<{ result: ImportResult | null }>(() => ({ result: null }));

// Explicit project reset removes retained issues. Release its File references too;
// dismissing only the visible banner keeps the unresolved issue and retry inputs.
useNotifications.subscribe((state, previous) => {
  if (useVideoImportStatus.getState().result
    && previous.unresolved.some(issue => issue.id === "importFailed" && issue.scope === "camera-import")
    && !state.unresolved.some(issue => issue.id === "importFailed" && issue.scope === "camera-import")) {
    useVideoImportStatus.setState({ result: null });
  }
});

/** Imports one batch atomically and retains all failed files for an explicit retry. */
export async function importVideos(files: readonly File[], previousSuccess = 0) {
  const initial = useCapture.getState();
  if (!files.length || initial.importing) return;
  initial.patch({ importing: true });
  const failed: File[] = [];
  const urls: string[] = [];
  let imported = 0;
  try {
    let clips = [...initial.clips];
    let replaced = false;
    for (const file of files) {
      const url = URL.createObjectURL(file);
      try {
        const { duration, width, height } = await readVideoMetadata(url);
        const index = !replaced && initial.replacing != null
          ? clips.findIndex(clip => clip.id === initial.replacing) : -1;
        const clip = mkClip(round2(duration), url, clips.length, width, height);
        if (index >= 0) {
          clip.color = clips[index].color;
          clips[index] = clip;
          replaced = true;
        } else clips.push(clip);
        urls.push(url);
        imported++;
      } catch {
        URL.revokeObjectURL(url);
        failed.push(file);
      }
    }
    const current = useCapture.getState();
    if (current.currentSceneId !== initial.currentSceneId || current.clips !== initial.clips) {
      urls.forEach(url => URL.revokeObjectURL(url));
      return;
    }
    if (imported) {
      const index = replaced ? initial.clips.findIndex(clip => clip.id === initial.replacing) : -1;
      current.edit({ clips, replacing: replaced ? null : initial.replacing,
        screen: replaced ? "editor" : initial.screen, sel: index,
        t: replaced ? total(clips.slice(0, index)) : initial.t });
    }
    useVideoImportStatus.setState({ result: failed.length ? { failed, imported: previousSuccess + imported } : null });
    if (failed.length) notify("importFailed", { scope: "camera-import", currentAttempt: true });
    else resolveNotification("importFailed", "camera-import");
  } finally {
    useCapture.getState().patch({ importing: false });
  }
}

export function retryFailedImports() {
  const result = useVideoImportStatus.getState().result;
  return result ? importVideos(result.failed, result.imported) : Promise.resolve();
}

export function dismissImportResult() {
  useVideoImportStatus.setState({ result: null });
  resolveNotification("importFailed", "camera-import");
}
