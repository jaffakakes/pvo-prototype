import { deleteSelectedAudio, splitSelectedAudio } from "../state/editing/audioCommands";
import { sceneDuration } from "../domain/audio/editing";
import { useEffect } from "react";
import { clamp } from "../domain/project/numbers";
import { startTry, stopTry } from "../features/preview/tryMode";
import { togglePlayback } from "../features/preview/playbackCommands";
import { deleteSelectedClip, splitAtPlayhead } from "../features/timeline/clipCommands";
import { acceptPlayheadPick, cancelPlayheadPick } from "../features/timeline/playheadPick";
import { useCapture } from "../state/captureStore";
import { useAssistant } from "../state/assistant/assistantStore";
import { clearTimelineSelection, deleteTimelineSelection, duplicateTimelineSelection, splitSelectedClip, undoTimelineEdit } from "../state/editing/selectionCommands";

export function useEditorKeyboard(enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const keydown = (event: KeyboardEvent) => {
      if (useAssistant.getState().phase !== "idle" || event.defaultPrevented
        || document.querySelector('dialog[open], [data-desktop-inspector][aria-modal="true"]')) return;
      const target = event.target as HTMLElement;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target.isContentEditable)
        return;
      const s = useCapture.getState();
      const desktop = document.querySelector("[data-desktop-editor]");
      if (desktop && !desktop.matches(":hover")) return;
      if (s.playheadPick) {
        if (event.key === "Escape") {
          event.preventDefault();
          cancelPlayheadPick();
          return;
        }
        if (event.key === "Enter") {
          if (target instanceof HTMLButtonElement)
            return;
          event.preventDefault();
          acceptPlayheadPick();
          return;
        }
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          const step = event.shiftKey ? 1 : .1;
          s.patch({ t: clamp(s.t + (event.key === "ArrowRight" ? step : -step), 0, sceneDuration(s)) });
          return;
        }
        if (event.key === " " || event.code === "Space" || event.ctrlKey || event.metaKey)
          event.preventDefault();
        return;
      }
      if (event.key === "Escape") {
        if (s.tryMode)
          stopTry();
        else if (desktop)
          clearTimelineSelection();
        else if (s.ratioMenu)
          s.patch({ ratioMenu: false });
        else if (s.sheet)
          s.patch({ sheet: null });
        else if (s.orb)
          s.patch({ orb: false });
        else if (s.selComp)
          s.patch({ selComp: null });
        else if (s.selText != null)
          s.patch({ selText: null });
        else if (s.selAudio != null)
          s.patch({ selAudio: null });
        else if (s.sel >= 0)
          s.patch({ sel: -1 });
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (!s.tryMode) {
          if (desktop)
            undoTimelineEdit(event.shiftKey);
          else if (event.shiftKey)
            s.redo();
          else
            s.undo();
        }
        return;
      }
      if (desktop && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") {
        event.preventDefault();
        duplicateTimelineSelection();
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (desktop && !s.tryMode && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        event.preventDefault();
        const step = event.shiftKey ? 1 : .1;
        s.patch({ t: clamp(s.t + (event.key === "ArrowRight" ? step : -step), 0, sceneDuration(s)), playing: false });
        return;
      }
      if (s.screen !== "editor" || !s.scenes.some(scene => scene.clips.length || scene.audioClips?.length))
        return;
      if (event.key.toLowerCase() === "c" && !s.tryMode) {
        s.patch({ sheet: "components", playing: false, orb: false });
        return;
      }
      if (event.key.toLowerCase() === "t") {
        event.preventDefault();
        if (s.tryMode)
          stopTry();
        else
          startTry();
        return;
      }
      if (event.code === "Space") {
        if (target instanceof HTMLButtonElement) return;
        event.preventDefault();
        togglePlayback();
      }
      if (s.selAudio != null && ["s", "Backspace", "Delete"].includes(event.key)) {
        event.preventDefault();
        if (event.key === "s") splitSelectedAudio(); else deleteSelectedAudio();
        return;
      }
      if (event.key.toLowerCase() === "s" && !s.tryMode && !s.sheet) {
        if (desktop) splitSelectedClip();
        else splitAtPlayhead(s);
      }
      if (desktop && (event.key === "Delete" || event.key === "Backspace") && !s.tryMode) {
        event.preventDefault();
        deleteTimelineSelection();
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && s.selComp && !s.tryMode) {
        event.preventDefault();
        s.deleteComponent(s.selComp);
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && s.selText != null && !s.tryMode) {
        event.preventDefault();
        s.deleteText(s.selText);
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && s.sel >= 0 && !s.tryMode)
        deleteSelectedClip(s);
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [enabled]);
}
