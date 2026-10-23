import type { PersistenceSnapshot } from "./checkpoint";

export type ProjectMarkers = Pick<
  PersistenceSnapshot,
  | "scenes"
  | "past"
  | "future"
  | "ratio"
  | "coverAt"
  | "allowedDomains"
  | "currentSceneId"
  | "screen"
  | "sel"
  | "selComp"
  | "selText"
  | "quality"
  | "localId"
  | "projectName"
  | "assistantTaskLinks"
> & { t: number };

export function projectMarkers(state: PersistenceSnapshot): ProjectMarkers {
  return {
    localId: state.localId,
    projectName: state.projectName,
    assistantTaskLinks: state.assistantTaskLinks,
    scenes: state.scenes,
    past: state.past,
    future: state.future,
    ratio: state.ratio,
    coverAt: state.coverAt,
    allowedDomains: state.allowedDomains,
    currentSceneId: state.currentSceneId,
    screen: state.screen,
    sel: state.sel,
    selComp: state.selComp,
    selText: state.selText,
    quality: state.quality,
    t: state.t,
  };
}

export function shouldQueueProject(
  current: ProjectMarkers,
  previous: ProjectMarkers | null,
  state: PersistenceSnapshot,
): boolean {
  if (!previous) return true;
  if (
    current.localId !== previous.localId ||
    current.projectName !== previous.projectName ||
    current.assistantTaskLinks !== previous.assistantTaskLinks
  )
    return true;
  if (
    current.scenes !== previous.scenes ||
    current.past !== previous.past ||
    current.future !== previous.future ||
    current.ratio !== previous.ratio ||
    current.coverAt !== previous.coverAt ||
    current.allowedDomains !== previous.allowedDomains ||
    current.currentSceneId !== previous.currentSceneId ||
    current.screen !== previous.screen ||
    current.sel !== previous.sel ||
    current.selComp !== previous.selComp ||
    current.selText !== previous.selText ||
    current.quality !== previous.quality
  )
    return true;
  // Playback can patch time every frame. Every paused scrub is saved after debounce.
  return !state.playing && current.t !== previous.t;
}
