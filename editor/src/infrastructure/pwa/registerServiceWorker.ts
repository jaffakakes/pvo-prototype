import { connectReleaseNotifications } from "./releaseConnection";

type EditorUpdateState = Readonly<{
  available: boolean;
  applying: boolean;
  error: string | null;
  revision: number;
}>;

const ACTIVATION_TIMEOUT_MS = 15 * 1000;
const listeners = new Set<() => void>();

let updateState: EditorUpdateState = Object.freeze({
  available: false,
  applying: false,
  error: null,
  revision: 0,
});
let registration: ServiceWorkerRegistration | null = null;
let registered = false;
let checking = false;
let releasePending = false;
let reloadRequested = false;
let activationTimeout: number | undefined;

function publish(changes: Partial<Omit<EditorUpdateState, "revision">>): void {
  const next = { ...updateState, ...changes };
  if (next.available === updateState.available
    && next.applying === updateState.applying
    && next.error === updateState.error) return;
  updateState = Object.freeze({ ...next, revision: updateState.revision + 1 });
  listeners.forEach(listener => listener());
}

export function getEditorUpdateState(): EditorUpdateState {
  return updateState;
}

export function subscribeEditorUpdates(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function refreshWaitingState(): void {
  if (!registration || updateState.applying) return;
  publish({
    available: Boolean(navigator.serviceWorker.controller && registration.waiting),
  });
}

function watchInstallingWorker(worker: ServiceWorker | null): void {
  if (!worker) return;
  const onStateChange = () => {
    if (worker.state === "installed" || worker.state === "redundant") {
      refreshWaitingState();
      // Registration.waiting can be assigned just after the state transition.
      queueMicrotask(refreshWaitingState);
      worker.removeEventListener("statechange", onStateChange);
      if (releasePending) window.setTimeout(() => { void checkForUpdate(); }, 0);
    }
  };
  worker.addEventListener("statechange", onStateChange);
  onStateChange();
}

async function checkForUpdate(): Promise<void> {
  // Registering a first worker already fetches it; update() is for existing installs.
  if (!registration?.active || registration.installing || registration.waiting
    || checking || updateState.applying
    || document.visibilityState !== "visible" || !navigator.onLine) return;
  releasePending = false;
  checking = true;
  try {
    await registration.update();
    publish({ error: null });
    refreshWaitingState();
  } catch (error) {
    console.warn("Restyle could not check for a new beta release:", error);
    publish({ error: "Couldn't check for a new beta release. Try again when online." });
  } finally {
    checking = false;
    if (releasePending) void checkForUpdate();
  }
}

function reloadOnce(): void {
  if (reloadRequested) return;
  reloadRequested = true;
  clearTimeout(activationTimeout);
  window.location.reload();
}

export function activateEditorUpdate(): boolean {
  const waiting = registration?.waiting;
  if (!waiting || !updateState.available || updateState.applying) {
    refreshWaitingState();
    return false;
  }

  publish({ applying: true, error: null });
  activationTimeout = window.setTimeout(() => {
    if (reloadRequested) return;
    publish({ applying: false, error: "The update didn't start. Please try again." });
    refreshWaitingState();
  }, ACTIVATION_TIMEOUT_MS);
  try {
    waiting.postMessage({ type: "SKIP_WAITING" });
    return true;
  } catch (error) {
    clearTimeout(activationTimeout);
    console.warn("Restyle could not start the beta update:", error);
    publish({ applying: false, error: "Couldn't start the update. Please try again." });
    refreshWaitingState();
    return false;
  }
}

/** Register only built, secure editor deployments; Vite development stays network-first. */
export function registerEditorServiceWorker(): void {
  if (registered || !import.meta.env.PROD || !window.isSecureContext || !("serviceWorker" in navigator)) return;
  registered = true;

  const start = async () => {
    const scope = new URL("./", window.location.href);
    const worker = new URL("sw.js", scope);
    try {
      registration = await navigator.serviceWorker.register(worker.href, {
        scope: scope.pathname,
        updateViaCache: "none",
      });
      publish({ error: null });
      registration.addEventListener("updatefound", () => watchInstallingWorker(registration?.installing ?? null));
      watchInstallingWorker(registration.installing);
      refreshWaitingState();
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (updateState.applying) reloadOnce();
        else {
          refreshWaitingState();
          if (releasePending) void checkForUpdate();
        }
      });
      connectReleaseNotifications(() => {
        releasePending = true;
        void checkForUpdate();
      });
    } catch (error) {
      console.warn("Restyle editor app shell could not be installed:", error);
      publish({ error: "Couldn't enable in-app updates. Try again when online." });
      window.addEventListener("online", () => { void start(); }, { once: true });
    }
  };

  if (document.readyState === "complete") void start();
  else window.addEventListener("load", () => { void start(); }, { once: true });
}
