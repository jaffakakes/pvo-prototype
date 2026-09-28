import type { ProjectSnapshot } from "./model";

type ProjectWithHistory = Pick<ProjectSnapshot, "scenes" | "ratio" | "allowedDomains"> & {
  hasHistory: boolean;
};

/** A reload would discard this in-memory project, including blob-backed media. */
export function hasUnfinishedWork(project: ProjectWithHistory): boolean {
  if (project.hasHistory || project.ratio !== "9:16" || project.allowedDomains.length > 0)
    return true;
  if (project.scenes.length !== 1)
    return true;

  return project.scenes.some(scene =>
    scene.id !== "main" ||
    scene.name !== "Main" ||
    scene.clips.length > 0 ||
    (scene.audioClips?.length ?? 0) > 0 ||
    scene.texts.length > 0 ||
    scene.components.length > 0 ||
    scene.muted ||
    scene.sound !== 0,
  );
}
