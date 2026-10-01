import { removeClipAt, splitClipAt } from "../../domain/clips/editing";
import { clamp } from "../../domain/project/numbers";
import { sceneDuration } from "../../domain/scenes/duration";
import { uid } from "../../infrastructure/ids";
import type { CaptureState } from "../../state/types";
import { notify } from "../../state/notifications/notificationStore";

type SplitContext = Pick<CaptureState, "clips" | "t" | "edit">;
type DeleteContext = SplitContext & Pick<
  CaptureState,
  | "sel"
  | "scenes"
  | "currentSceneId"
  | "audioClips"
  | "texts"
  | "components"
>;
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
  const current = { ...state, clips };
  const projectHasContent =
    sceneDuration(current) > 0 ||
    state.scenes.some(
      (scene) =>
        scene.id !== state.currentSceneId && sceneDuration(scene) > 0,
    );
  state.edit({
    clips,
    sel: -1,
    t: clamp(state.t, 0, sceneDuration(current)),
    playing: false,
    screen: projectHasContent ? "editor" : "camera",
  });
}
