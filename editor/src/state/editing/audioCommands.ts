import {
  audioDuration,
  dragAudio,
  extractClipAudio,
  splitAudio,
} from "../../domain/audio/editing";
import { sceneDuration } from "../../domain/scenes/duration";
import type { AudioClip } from "../../domain/audio/model";
import { uid } from "../../infrastructure/ids";
import { useCapture } from "../captureStore";
import { useAssistant } from "../assistant/assistantStore";
import { projectSnapshot } from "../project/history";

const blocked = () => {
  const state = useCapture.getState();
  return (
    !!state.tryMode ||
    !!state.playheadPick ||
    state.recording ||
    state.ex === "running" ||
    useAssistant.getState().phase !== "idle"
  );
};

export function extractSelectedAudio() {
  const state = useCapture.getState();
  if (blocked()) return;
  const result = extractClipAudio(state.clips, state.sel, uid(), state.muted);
  if (!result) return;
  state.edit({
    clips: result.clips,
    audioClips: [...state.audioClips, result.audio],
    selAudio: result.audio.id,
    sel: -1,
    sheet: null,
    playing: false,
  });
}

export function updateSelectedAudio(
  changes: Partial<Pick<AudioClip, "muted" | "start">>,
) {
  const state = useCapture.getState();
  if (blocked() || state.selAudio == null) return;
  state.edit({
    audioClips: state.audioClips.map((clip) =>
      clip.id === state.selAudio
        ? {
            ...clip,
            ...changes,
            start: Math.max(0, changes.start ?? clip.start),
          }
        : clip,
    ),
    playing: false,
  });
}

export function deleteSelectedAudio() {
  const state = useCapture.getState();
  if (blocked() || state.selAudio == null) return;
  const audioClips = state.audioClips.filter(
    (clip) => clip.id !== state.selAudio,
  );
  state.edit({
    audioClips,
    selAudio: null,
    t: Math.min(state.t, sceneDuration({ ...state, audioClips })),
    playing: false,
  });
}

export function splitSelectedAudio() {
  const state = useCapture.getState();
  if (blocked()) return;
  const clip = state.audioClips.find((item) => item.id === state.selAudio);
  const parts = clip && splitAudio(clip, state.t, uid());
  if (!parts) return;
  state.edit({
    audioClips: state.audioClips.flatMap((item) =>
      item.id === clip.id ? parts : [item],
    ),
    selAudio: parts[1].id,
    playing: false,
  });
}

export function duplicateSelectedAudio() {
  const state = useCapture.getState();
  const clip = state.audioClips.find((item) => item.id === state.selAudio);
  if (blocked() || !clip) return;
  const copy = { ...clip, id: uid(), start: clip.start + audioDuration(clip) };
  state.edit({
    audioClips: [...state.audioClips, copy],
    selAudio: copy.id,
    playing: false,
  });
}

export function beginAudioTimingDrag(id: number, mode: "move" | "l" | "r") {
  const before = useCapture.getState();
  const original = before.audioClips.find((clip) => clip.id === id);
  if (!original || blocked()) return null;
  const snapshot = projectSnapshot(before);
  let ended = false;
  let changed = false;
  const active = () => {
    const state = useCapture.getState();
    return (
      !ended &&
      state.past === before.past &&
      state.future === before.future &&
      state.currentSceneId === before.currentSceneId &&
      !blocked() &&
      state.audioClips.some((clip) => clip.id === id)
    );
  };
  const cancel = () => {
    const state = useCapture.getState();
    if (
      !ended &&
      changed &&
      state.past === before.past &&
      state.future === before.future
    ) {
      const scene = state.scenes.find(
        (item) => item.id === before.currentSceneId,
      );
      if (scene)
        state.updateScene(
          scene.id,
          {
            audioClips: (scene.audioClips ?? []).map((clip) =>
              clip.id === id
                ? {
                    ...clip,
                    in: original.in,
                    out: original.out,
                    start: original.start,
                  }
                : clip,
            ),
          },
          false,
        );
    }
    ended = true;
  };
  return {
    update(delta: number) {
      if (!active()) return false;
      const next = dragAudio(original, mode, delta);
      changed =
        next.start !== original.start ||
        next.in !== original.in ||
        next.out !== original.out;
      const state = useCapture.getState();
      state.patch({
        audioClips: state.audioClips.map((clip) =>
          clip.id === id ? next : clip,
        ),
        playing: false,
      });
      return true;
    },
    commit() {
      if (!active()) {
        cancel();
        return;
      }
      if (changed)
        useCapture
          .getState()
          .patch({ past: [...before.past, snapshot].slice(-40), future: [] });
      ended = true;
    },
    cancel,
  };
}
