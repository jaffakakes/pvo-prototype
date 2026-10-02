/** Settle immediately on cancellation even when an underlying decoder cannot be interrupted. */
export function cancellable<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) {
    void work.catch(() => {});
    return Promise.reject(signal.reason ?? new DOMException("Inspection cancelled.", "AbortError"));
  }
  return new Promise<T>((resolve, reject) => {
    const cancel = () => { cleanup(); reject(signal?.reason ?? new DOMException("Inspection cancelled.", "AbortError")); };
    const cleanup = () => signal?.removeEventListener("abort", cancel);
    signal?.addEventListener("abort", cancel, { once: true });
    work.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}

export function waitForMedia(
  video: HTMLVideoElement,
  event: "loadeddata" | "seeked",
  start: () => void,
  signal?: AbortSignal,
  timeoutMs = 15000,
): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener(event, done);
      video.removeEventListener("error", fail);
      signal?.removeEventListener("abort", cancel);
    };
    const done = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error("The source video could not be decoded for inspection.")); };
    const cancel = () => { cleanup(); reject(signal?.reason ?? new DOMException("Inspection cancelled.", "AbortError")); };
    const timer = setTimeout(() => { cleanup(); reject(new Error("Reading a video frame timed out.")); }, timeoutMs);
    video.addEventListener(event, done, { once: true });
    video.addEventListener("error", fail, { once: true });
    signal?.addEventListener("abort", cancel, { once: true });
    try { start(); } catch (error) { cleanup(); reject(error); }
  });
}

export function releaseVideo(video: HTMLVideoElement) {
  video.pause();
  video.removeAttribute("src");
  video.load();
}

/** A seeked event can precede presentation of the decoded frame on a newly loaded decoder. */
export function seekPresentedFrame(video: HTMLVideoElement, time: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  if (typeof video.requestVideoFrameCallback !== "function")
    return Promise.reject(new Error("This browser cannot confirm decoded video frames for inspection."));
  return new Promise((resolve, reject) => {
    let callback = 0;
    let sought = false;
    let presented = false;
    const cleanup = () => {
      clearTimeout(timer);
      video.cancelVideoFrameCallback(callback);
      video.removeEventListener("seeked", seeked);
      video.removeEventListener("error", failed);
      signal?.removeEventListener("abort", cancel);
    };
    const cancel = () => { cleanup(); reject(signal?.reason ?? new DOMException("Inspection cancelled.", "AbortError")); };
    const done = () => { if (sought && presented) { cleanup(); resolve(); } };
    const seeked = () => { sought = true; done(); };
    const failed = () => { cleanup(); reject(new Error("The source video could not be decoded for inspection.")); };
    const timer = setTimeout(() => { cleanup(); reject(new Error("The decoded video frame was not ready.")); }, 5000);
    signal?.addEventListener("abort", cancel, { once: true });
    video.addEventListener("seeked", seeked);
    video.addEventListener("error", failed);
    try {
      callback = video.requestVideoFrameCallback(() => { presented = true; done(); });
      video.currentTime = time;
    } catch (error) { cleanup(); reject(error); }
  });
}

/** Inspection accepts existing local project assets, never destinations supplied by a model. */
export function projectMediaUrl(value: string): string {
  const url = new URL(value, location.href);
  if (!["blob:", "http:", "https:"].includes(url.protocol) || url.origin !== location.origin
    || url.username || url.password)
    throw new Error("This media must be imported into the project before inspection.");
  return url.href;
}
