import { useRef, useState } from "react";
import { useCapture } from "../../../state/captureStore";
import { useAssistant } from "../../../state/assistant/assistantStore";
import { useAuthGate } from "../../../state/auth/authGateStore";
import type { CaptureState } from "../../../state/types";
import { insertLibraryClips } from "../../../state/editing/libraryCommands";
import { usePageDrop } from "../../create-project/usePageDrop";
import { useProjectMedia } from "../../create-project/useProjectMedia";

function editingLocked(state: CaptureState) {
  return state.importing || state.recording || state.tryMode !== null || state.playheadPick !== null
    || state.ex === "running" || ["more", "export", "discard"].includes(state.sheet ?? "");
}

export function useLibraryMedia(onImport: () => void) {
  const prepared = useProjectMedia();
  const input = useRef<HTMLInputElement>(null);
  const importing = useCapture(state => state.importing);
  const locked = useCapture(editingLocked);
  const assistantActive = useAssistant(state => state.phase !== "idle");
  const authOpen = useAuthGate(state => state.source !== null);
  const [placementError, setPlacementError] = useState<string | null>(null);

  const run = async (load: () => ReturnType<typeof prepared.addFiles>) => {
    const before = useCapture.getState();
    if (editingLocked(before) || useAssistant.getState().phase !== "idle" || useAuthGate.getState().source !== null) return;
    before.patch({ importing: true, playing: false });
    setPlacementError(null);
    onImport();
    try {
      const ready = await load();
      const current = useCapture.getState();
      if (before.localId !== current.localId || before.currentSceneId !== current.currentSceneId) {
        if (ready.length) setPlacementError("The scene changed during import. Open that scene and import the files again.");
        prepared.discard(ready);
        return;
      }
      if (editingLocked({ ...current, importing: false }) || useAssistant.getState().phase !== "idle" || useAuthGate.getState().source !== null) {
        prepared.discard(ready);
        if (ready.length) setPlacementError("Finish the current action, then import the files again.");
        return;
      }
      if (insertLibraryClips(ready.map(item => item.clip))) prepared.transfer(ready);
      else prepared.discard(ready);
    } finally {
      useCapture.getState().patch({ importing: false });
    }
  };

  const addFiles = (files: File[]) => {
    if (files.length) void run(() => prepared.addFiles(files));
  };
  const dragging = usePageDrop(addFiles, locked || assistantActive || authOpen);
  return {
    input, importing, dragging, addFiles,
    progress: prepared.progress,
    error: placementError ?? prepared.error,
    openPicker: () => input.current?.click(),
    loadSample: () => { void run(prepared.loadSample); },
  };
}

export type LibraryMedia = ReturnType<typeof useLibraryMedia>;
