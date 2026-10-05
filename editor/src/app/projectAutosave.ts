import { highestProjectId } from "../domain/project/highestProjectId";
import { hasUnfinishedWork } from "../domain/project/unfinishedWork";
import { advanceUidPast } from "../infrastructure/ids";
import {
  createProjectPersistence,
  type RestoredProject,
} from "../infrastructure/projectPersistence";
import { restore } from "../state/project/history";
import { useCapture } from "../state/captureStore";
import {
  notify,
  resolveNotification,
} from "../state/notifications/notificationStore";
import { createProjectAutosaveController } from "./projectAutosaveController";

const persistence = createProjectPersistence(
  new URL(location.href).searchParams.get("project") ?? undefined,
);

function hydrateProject(saved: RestoredProject): void {
  const state = useCapture.getState();
  advanceUidPast(
    highestProjectId([saved.project, ...saved.past, ...saved.future]),
  );
  const position = {
    ...state,
    screen: saved.screen,
    t: saved.t,
    sel: saved.sel,
    selComp: saved.selComp,
    selText: saved.selText,
    exportFormat: saved.exportFormat,
  };
  useCapture.setState({
    localId:
      saved.localId ??
      (hasUnfinishedWork({
        ...saved.project,
        hasHistory: saved.past.length > 0 || saved.future.length > 0,
      })
        ? crypto.randomUUID()
        : null),
    projectName: saved.projectName ?? "Untitled edit",
    assistantTaskLinks: saved.assistantTaskLinks,
    ...restore(position, saved.project),
    past: saved.past,
    future: saved.future,
    quality: saved.quality,
  });
}

const autosave = createProjectAutosaveController({
  persistence,
  store: useCapture,
  hydrate: hydrateProject,
  failed: (kind, error) => {
    console.error(`Restyle project storage (${kind}):`, error);
    notify(kind, { scope: "project" });
  },
  recovered: (kind) => resolveNotification(kind, "project"),
});

export const startProjectAutosave = autosave.start;
export const saveProjectBeforeUpdate = autosave.saveBeforeUpdate;
export const retryProjectStorage = autosave.retry;
export const discardProjectRecovery = autosave.discardRecovery;
export const getProjectStorageStatus = autosave.getStatus;
export const subscribeProjectStorage = autosave.subscribe;
