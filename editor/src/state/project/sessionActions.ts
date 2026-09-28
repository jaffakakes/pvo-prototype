import { initial } from "./initial";
import { markProjectDiscarded } from "../../infrastructure/projectPersistence/discardMarker";
import type { CaptureState } from "../types";
import { resetNotifications } from "../notifications/notificationStore";
import { resetExportArtifact } from "../export/exportArtifactStore";

export function createSessionActions(set: import("zustand").StoreApi<CaptureState>["setState"], get: () => CaptureState): Pick<CaptureState, "reset"> {
  return {
    reset: () => {
      markProjectDiscarded();
      const state = get();
      // Reset is the only place media can be revoked: deleted clips may still be in undo/redo.
      const urls = new Set<string>();
      for (const scenes of [state.scenes, ...state.past.map(item => item.scenes), ...state.future.map(item => item.scenes)]) {
        for (const scene of scenes)
          for (const clip of [...scene.clips, ...(scene.audioClips ?? [])])
            if (clip.url)
              urls.add(clip.url);
      }
      urls.forEach(url => URL.revokeObjectURL(url));
      resetExportArtifact();
      set({ ...initial(), camOn: state.camOn, facing: state.facing });
      resetNotifications();
    }
  };
}
