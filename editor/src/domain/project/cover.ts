import { sceneDuration } from "../scenes/duration";
import type { ProjectSnapshot } from "./model";
import { clamp } from "./numbers";

/** Keep the selected frame inside the main scene after edits shorten its timeline. */
export function exportCoverAt(project: Pick<ProjectSnapshot, "scenes" | "coverAt">): number {
  if (!Number.isFinite(project.coverAt) || project.coverAt < 0)
    throw new Error("Choose a valid cover frame before exporting.");
  const main = project.scenes.find(scene => scene.id === "main");
  if (!main) throw new Error("Main scene is missing from this project.");
  const end = Math.max(0, sceneDuration(main) - 1 / 30);
  return clamp(project.coverAt, 0, end);
}
