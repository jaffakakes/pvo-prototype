/** The caller owns the URL; this adapter always releases its temporary decoder. */
export async function readVideoMetadata(url: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const video = document.createElement("video");
  video.preload = "metadata";
  let cancel = () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      cancel = () => reject(new DOMException("Video loading cancelled.", "AbortError"));
      signal?.addEventListener("abort", cancel, { once: true });
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("This browser couldn't read the video. Try an MP4 with H.264 video."));
      timer = setTimeout(() => reject(new Error("Reading the video took too long. Try again.")), 20000);
      video.src = url;
    });
    return { duration: Number.isFinite(video.duration) ? video.duration : 3,
      width: video.videoWidth || 9, height: video.videoHeight || 16 };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
    video.onloadedmetadata = null;
    video.onerror = null;
    video.removeAttribute("src");
    video.load();
  }
}
