import type { ProjectSnapshot, Scene } from "../../domain/project/model";
import { cloneScenes } from "../../domain/project/snapshot";
import { normalizeSceneTree } from "../../domain/scenes/rules";

export type RestoredProject = {
  localId?: string;
  projectName?: string;
  project: ProjectSnapshot;
  past: ProjectSnapshot[];
  future: ProjectSnapshot[];
  screen: "camera" | "editor";
  t: number;
  sel: number;
  selComp: string | null;
  selText: number | null;
  exportFormat: "video" | "pvo";
  quality: "720p" | "1080p";
  savedAt: number;
};

type ResumePosition = Pick<
  RestoredProject,
  "screen" | "t" | "sel" | "selComp" | "selText" | "exportFormat" | "quality"
>;

export type PersistenceSnapshot = ProjectSnapshot &
  ResumePosition & {
    localId: string | null;
    projectName: string;
    past: ProjectSnapshot[];
    future: ProjectSnapshot[];
    playing: boolean;
  };

export type StoredCheckpoint = {
  localId?: string;
  projectName?: string;
  version: 2;
  savedAt: number;
  project: ProjectSnapshot;
  past: ProjectSnapshot[];
  future: ProjectSnapshot[];
  resume: ResumePosition;
  assetIds: string[];
};

export type CheckpointDraft = Omit<StoredCheckpoint, "savedAt" | "assetIds">;

function cloneProject(project: ProjectSnapshot): ProjectSnapshot {
  return {
    scenes: cloneScenes(normalizeSceneTree(project.scenes)),
    currentSceneId: project.currentSceneId,
    ratio: project.ratio,
    allowedDomains: project.allowedDomains.slice(),
  };
}

export function captureCheckpoint(state: PersistenceSnapshot): CheckpointDraft {
  return {
    version: 2,
    localId: state.localId ?? undefined,
    projectName: state.projectName,
    project: cloneProject(state),
    past: state.past.map(cloneProject),
    future: state.future.map(cloneProject),
    resume: {
      screen: state.screen,
      t: state.t,
      sel: state.sel,
      selComp: state.selComp,
      selText: state.selText,
      exportFormat: state.exportFormat,
      quality: state.quality,
    },
  };
}

function allScenes(checkpoint: CheckpointDraft): Scene[][] {
  return [
    checkpoint.project.scenes,
    ...checkpoint.past.map((item) => item.scenes),
    ...checkpoint.future.map((item) => item.scenes),
  ];
}

export function referencedMedia(checkpoint: CheckpointDraft): string[] {
  const urls = new Set<string>();
  for (const scenes of allScenes(checkpoint))
    for (const scene of scenes)
      for (const clip of [...scene.clips, ...(scene.audioClips ?? [])]) if (clip.url) urls.add(clip.url);
  return [...urls];
}

function remapProject(
  project: ProjectSnapshot,
  urlMap: Map<string, string>,
): ProjectSnapshot {
  return {
    ...project,
    scenes: normalizeSceneTree(project.scenes).map((scene) => ({
      ...scene,
      ...(scene.audioClips ? { audioClips: scene.audioClips.map(clip => ({
        ...clip, url: clip.url ? (urlMap.get(clip.url) ?? null) : null,
      })) } : {}),
      clips: scene.clips.map((clip) => ({
        ...clip,
        url: clip.url ? (urlMap.get(clip.url) ?? null) : null,
      })),
    })),
  };
}

export function storeCheckpoint(
  draft: CheckpointDraft,
  assetIdByUrl: Map<string, string>,
  savedAt: number,
): StoredCheckpoint {
  const assetIds = referencedMedia(draft).map((url) => {
    const assetId = assetIdByUrl.get(url);
    if (!assetId) throw new Error("A video clip has no browser storage ID.");
    return assetId;
  });
  return {
    ...draft,
    project: remapProject(draft.project, assetIdByUrl),
    past: draft.past.map((item) => remapProject(item, assetIdByUrl)),
    future: draft.future.map((item) => remapProject(item, assetIdByUrl)),
    assetIds,
    savedAt,
  };
}

export function restoreCheckpoint(
  record: StoredCheckpoint,
  urlMap: Map<string, string>,
): RestoredProject {
  return {
    localId: record.localId,
    projectName: record.projectName,
    project: remapProject(record.project, urlMap),
    past: record.past.map((item) => remapProject(item, urlMap)),
    future: record.future.map((item) => remapProject(item, urlMap)),
    ...record.resume,
    savedAt: record.savedAt,
  };
}

export function validateCheckpoint(
  record: unknown,
): asserts record is StoredCheckpoint {
  if (!record || typeof record !== "object")
    throw new Error("Saved project data is missing.");
  const value = record as Partial<StoredCheckpoint>;
  if (
    (value.localId !== undefined &&
      (typeof value.localId !== "string" ||
        !/^[a-zA-Z0-9-]{1,80}$/.test(value.localId))) ||
    (value.projectName !== undefined &&
      (typeof value.projectName !== "string" || value.projectName.length > 120))
  )
    throw new Error("Saved project identity is invalid.");
  if (
    value.version !== 2 ||
    !value.project ||
    !Array.isArray(value.project.scenes) ||
    !Array.isArray(value.past) ||
    !Array.isArray(value.future) ||
    !Array.isArray(value.assetIds) ||
    !value.resume
  )
    throw new Error("This saved project format is not supported.");
  if (
    !value.project.scenes.length ||
    typeof value.project.currentSceneId !== "string" ||
    !value.project.scenes.some(
      (scene) => scene.id === value.project?.currentSceneId,
    ) ||
    !value.assetIds.every(
      (id) => typeof id === "string" && id.startsWith("asset:"),
    )
  )
    throw new Error("Saved project data is incomplete.");
  for (const scenes of allScenes(value as StoredCheckpoint)) {
    for (const scene of scenes) {
      if (scene.audioClips !== undefined && (!Array.isArray(scene.audioClips) || scene.audioClips.some(clip =>
        !clip || !Number.isSafeInteger(clip.id) || typeof clip.name !== "string"
        || (clip.url !== null && typeof clip.url !== "string") || typeof clip.muted !== "boolean"
        || ![clip.in, clip.out, clip.start, clip.speed, clip.srcDur].every(Number.isFinite)
        || clip.start < 0 || clip.in < 0 || clip.out <= clip.in || clip.out > clip.srcDur
        || clip.speed < .25 || clip.speed > 4)))
        throw new Error("Saved audio layer data is invalid.");
    }
  }
  const needed = referencedMedia(value as StoredCheckpoint);
  const available = new Set(value.assetIds);
  if (needed.some((url) => !available.has(url)))
    throw new Error("Saved project video is missing.");
}
