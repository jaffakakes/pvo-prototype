/** The caller owns the URL; this adapter always releases its temporary decoder. */
export async function readVideoMetadata(url: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const video = document.createElement("video");
  video.preload = "metadata";
  let cancel = () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      cancel = () =>
        reject(new DOMException("Video loading cancelled.", "AbortError"));
      signal?.addEventListener("abort", cancel, { once: true });
      video.onloadedmetadata = () => resolve();
      video.onerror = () =>
        reject(
          new Error(
            "This browser couldn't read the video. Try an MP4 with H.264 video.",
          ),
        );
      timer = setTimeout(
        () => reject(new Error("Reading the video took too long. Try again.")),
        20000,
      );
      video.src = url;
    });
    if (!Number.isFinite(video.duration) || video.duration <= 0)
      throw new Error(
        "This video's length couldn't be read. Try another file or export it as an MP4, then retry.",
      );
    if (
      !Number.isFinite(video.videoWidth) ||
      video.videoWidth <= 0 ||
      !Number.isFinite(video.videoHeight) ||
      video.videoHeight <= 0
    )
      throw new Error(
        "This video's dimensions couldn't be read. Try another file or export it as an MP4, then retry.",
      );
    return {
      duration: video.duration,
      width: video.videoWidth,
      height: video.videoHeight,
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
    video.onloadedmetadata = null;
    video.onerror = null;
    video.removeAttribute("src");
    video.load();
  }
}
