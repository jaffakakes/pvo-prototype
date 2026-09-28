/** The prepared export stays in the opener while authentication runs in a disposable popup. */
export function signInWithPopup(authUrl: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  const url = new URL(authUrl, location.origin);
  if (url.origin !== location.origin || !url.pathname.startsWith("/api/")) return Promise.reject(new Error("Sign-in isn’t available yet."));
  const popup = window.open(url.href, "restyle-sign-in", "popup,width=500,height=680");
  if (!popup) return Promise.reject(new Error("Allow a popup to sign in."));
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearInterval(poll); clearTimeout(timeout);
      window.removeEventListener("message", message);
      signal.removeEventListener("abort", abort);
      popup.close();
    };
    const finish = (error?: Error) => { cleanup(); if (error) reject(error); else resolve(); };
    const abort = () => finish(new DOMException("Sign-in cancelled.", "AbortError"));
    const message = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== popup || event.data?.type !== "restyle-auth") return;
      finish(event.data.ok === true ? undefined : new Error("Sign-in failed. Try again."));
    };
    const poll = setInterval(() => { if (popup.closed) abort(); }, 500);
    const timeout = setTimeout(() => finish(new Error("Sign-in timed out. Try again.")), 180000);
    window.addEventListener("message", message);
    signal.addEventListener("abort", abort, { once: true });
  });
}
