import { removeClipAt, splitClipAt } from "../../domain/clips/editing";
import { total } from "../../domain/clips/timing";
import { clamp } from "../../domain/project/numbers";
import { uid } from "../../infrastructure/ids";
import type { CaptureState } from "../../state/types";
import { notify } from "../../state/notifications/notificationStore";

type SplitContext = Pick<CaptureState, "clips" | "t" | "edit">;
type DeleteContext = SplitContext & Pick<CaptureState, "sel" | "scenes" | "currentSceneId">;
export function splitAtPlayhead(state: SplitContext) {
  const result = splitClipAt(state.clips, state.t, uid);
  if (!result) {
    notify("splitUnavailable", { scope: "timeline", currentAttempt: true });
    return;
  }
  state.edit({ clips: result.clips, sel: result.selectedIndex, playing: false });
}
export function deleteSelectedClip(state: DeleteContext) {
  if (state.sel < 0)
    return;
  const clips = removeClipAt(state.clips, state.sel);
  const projectHasClips = clips.length > 0 || state.scenes.some(scene => (scene.audioClips?.length ?? 0) > 0) || state.scenes.some(scene => scene.id !== state.currentSceneId && scene.clips.length > 0);
  state.edit({
    clips,
    sel: -1,
    t: clamp(state.t, 0, total(clips)),
    playing: false,
    screen: projectHasClips ? "editor" : "camera",
  });
}
