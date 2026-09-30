import type { StoreApi } from "zustand";
import { hasUnfinishedWork } from "../domain/project/unfinishedWork";
import type { ProjectPersistence, ProjectPersistenceStatus, RestoredProject } from "../infrastructure/projectPersistence";
import type { CaptureState } from "../state/types";

export type AutosaveStatus = {
  phase: "starting" | "ready" | "restore-failed" | "retrying";
  storage: ProjectPersistenceStatus;
  recoveryBlocked: boolean;
};

type Dependencies = {
  persistence: ProjectPersistence;
  store: Pick<StoreApi<CaptureState>, "getState" | "subscribe">;
  hydrate(saved: RestoredProject): void;
  failed(kind: "saveFailed" | "restoreFailed", error: unknown): void;
  recovered(kind: "saveFailed" | "restoreFailed"): void;
};

function hasPersistableProject(state: CaptureState) {
  return !!state.localId || hasUnfinishedWork({ scenes: state.scenes, ratio: state.ratio, allowedDomains: state.allowedDomains,
    hasHistory: state.past.length > 0 || state.future.length > 0 });
}

function hasWork(state: CaptureState) {
  return state.recording || state.importing || state.countdown > 0 || state.ex === "running" || hasPersistableProject(state);
}

/** Gates writes behind a successful restore; retry can never replace new work. */
export function createProjectAutosaveController({ persistence, store, hydrate, failed, recovered }: Dependencies) {
  let status: AutosaveStatus = { phase: "starting", storage: persistence.getStatus(), recoveryBlocked: false };
  let startup: Promise<void> | null = null;
  let restoring: Promise<void> | null = null;
  let restoringChanges = false;
  let awaitingReplacementProject = false;
  let restoreError: unknown;
  const listeners = new Set<() => void>();
  const publish = (values: Partial<AutosaveStatus>) => {
    status = { ...status, ...values };
    listeners.forEach(listener => listener());
  };
  const unsubscribeStorage = persistence.subscribeStatus(() => {
    const storage = persistence.getStatus();
    publish({ storage });
    if (status.phase !== "ready") return;
    if (storage.phase === "saved" && !storage.dirty) recovered("saveFailed");
    if (storage.phase === "error" && storage.error) failed("saveFailed", storage.error);
  });
  const unsubscribeStore = store.subscribe((next, previous) => {
    if (status.phase === "ready") {
      if (awaitingReplacementProject && !hasPersistableProject(next)) return;
      awaitingReplacementProject = false;
      persistence.schedule(next);
      return;
    }
    if (next.scenes !== previous.scenes || next.past !== previous.past || next.future !== previous.future
      || next.ratio !== previous.ratio || next.allowedDomains !== previous.allowedDomains
      || next.recording || next.importing) restoringChanges = true;
    const recoveryBlocked = hasWork(next);
    if (recoveryBlocked !== status.recoveryBlocked) publish({ recoveryBlocked });
  });

  const restore = (retry: boolean) => {
    if (restoring) return restoring;
    if (retry && hasWork(store.getState())) {
      publish({ recoveryBlocked: true });
      return Promise.resolve();
    }
    restoringChanges = false;
    publish({ phase: retry ? "retrying" : "starting", recoveryBlocked: false });
    restoring = (async () => {
      try {
        const saved = await persistence.restore();
        // Imports/recording can start during asynchronous storage access. Leave both
        // the current project and saved checkpoint intact if that happens.
        if (restoringChanges || hasWork(store.getState())) {
          // Persistence caches this result and owns its object URLs. Leave them
          // valid for a later safe retry; this path never starts a new write.
          restoreError = new Error("Recovery paused because this session contains new work.");
          publish({ phase: "restore-failed", recoveryBlocked: true });
          failed("restoreFailed", restoreError);
          return;
        }
        if (saved) hydrate(saved);
        restoreError = undefined;
        publish({ phase: "ready", recoveryBlocked: false });
        recovered("restoreFailed");
        persistence.schedule(store.getState());
      } catch (error) {
        restoreError = error;
        publish({ phase: "restore-failed", recoveryBlocked: hasWork(store.getState()) });
        failed("restoreFailed", error);
      } finally {
        restoring = null;
      }
    })();
    return restoring;
  };

  const start = () => startup ??= restore(false);
  const retry = async () => {
    if (status.phase === "restore-failed") return restore(true);
    if (status.phase !== "ready") return;
    const state = store.getState();
    if (awaitingReplacementProject && !hasPersistableProject(state)) return;
    awaitingReplacementProject = false;
    persistence.schedule(state);
    try { await persistence.flush(); } catch { /* The storage subscription reports this attempt. */ }
  };

  return {
    start, retry,
    async discardRecovery() {
      if (status.phase !== "restore-failed") return false;
      if (hasWork(store.getState())) {
        publish({ recoveryBlocked: true });
        return false;
      }
      publish({ phase: "retrying", recoveryBlocked: false });
      try {
        await persistence.discardSavedProject();
        restoreError = undefined;
        const state = store.getState();
        awaitingReplacementProject = !hasPersistableProject(state);
        publish({ phase: "ready", recoveryBlocked: false });
        recovered("restoreFailed");
        if (!awaitingReplacementProject) persistence.schedule(state);
        return true;
      } catch (error) {
        restoreError = error;
        publish({ phase: "restore-failed", recoveryBlocked: hasWork(store.getState()) });
        failed("restoreFailed", error);
        return false;
      }
    },
    getStatus: () => status,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async saveBeforeUpdate() {
      await start();
      const state = store.getState();
      if (status.phase !== "ready") {
        // Never treat an unread checkpoint as permission to overwrite it.
        if (hasWork(state)) throw restoreError ?? new Error("Project recovery is still pending.");
        return;
      }
      if (awaitingReplacementProject && !hasPersistableProject(state)) return;
      awaitingReplacementProject = false;
      persistence.schedule(state);
      try { await persistence.flush(); } catch (error) { if (hasWork(state)) throw error; }
    },
    dispose() { unsubscribeStorage(); unsubscribeStore(); listeners.clear(); },
  };
}
