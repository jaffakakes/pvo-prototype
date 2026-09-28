/** Reconnect the push channel after interruptions; never poll for releases. */
export function connectReleaseNotifications(onRelease: () => void): () => void {
  let socket: WebSocket | null = null;
  let retry: number | undefined;
  let attempts = 0;
  let stopped = false;

  const disconnect = () => {
    window.clearTimeout(retry);
    retry = undefined;
    const previous = socket;
    socket = null;
    previous?.close();
  };
  const connect = () => {
    if (stopped || socket || document.visibilityState !== "visible" || !navigator.onLine) return;
    window.clearTimeout(retry);
    retry = undefined;
    const url = new URL("/api/releases/connect", window.location.origin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const current = new WebSocket(url);
    socket = current;
    let revision: string | null = null;
    current.onmessage = event => {
      if (socket !== current || typeof event.data !== "string" || event.data.length > 256) return;
      try {
        const message = JSON.parse(event.data);
        if (message?.type !== "release" || typeof message.revision !== "string"
          || !/^restyle-editor-shell-[a-f0-9]{16}$/.test(message.revision)
          || message.revision === revision) return;
        revision = message.revision;
        attempts = 0;
        onRelease();
      } catch {
        // Ignore malformed channel messages; they cannot start an update.
      }
    };
    current.onclose = () => {
      if (socket !== current) return;
      socket = null;
      if (stopped || document.visibilityState !== "visible" || !navigator.onLine) return;
      const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempts++, 5));
      retry = window.setTimeout(connect, delay + Math.random() * 500);
    };
    current.onerror = () => current.close();
  };
  const resume = () => {
    if (document.visibilityState !== "visible" || !navigator.onLine) disconnect();
    else connect();
  };
  document.addEventListener("visibilitychange", resume);
  window.addEventListener("online", resume);
  window.addEventListener("offline", resume);
  window.addEventListener("pagehide", disconnect);
  window.addEventListener("pageshow", resume);
  connect();
  return () => {
    stopped = true;
    disconnect();
    document.removeEventListener("visibilitychange", resume);
    window.removeEventListener("online", resume);
    window.removeEventListener("offline", resume);
    window.removeEventListener("pagehide", disconnect);
    window.removeEventListener("pageshow", resume);
  };
}
