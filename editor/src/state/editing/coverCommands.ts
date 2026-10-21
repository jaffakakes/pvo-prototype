import { exportCoverAt } from "../../domain/project/cover";
import { useCapture } from "../captureStore";

/** Commit one cover choice; scrubbing and cancelling stay outside project history. */
export function saveProjectCover(time: number) {
  const state = useCapture.getState();
  const coverAt = exportCoverAt({ scenes: state.scenes, coverAt: time });
  if (coverAt !== state.coverAt) state.edit({ coverAt });
}
