/** Use media time on each display frame; stopping/seeking paints the final position. */
export function bindAnimationClock(video, render) {
  let frame = 0;
  let disposed = false;
  const paint = () => {
    frame = 0;
    if (disposed) return;
    render();
    if (!video.paused && !video.ended) frame = requestAnimationFrame(paint);
  };
  const stop = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    if (!disposed) render();
  };
  const seeked = () => { stop(); if (!video.paused) start(); };
  const start = () => { if (!frame && !disposed) frame = requestAnimationFrame(paint); };
  video.addEventListener("play", start);
  video.addEventListener("pause", stop);
  video.addEventListener("ended", stop);
  video.addEventListener("seeked", seeked);
  video.addEventListener("loadeddata", stop);
  if (!video.paused) start();
  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    video.removeEventListener("play", start);
    video.removeEventListener("pause", stop);
    video.removeEventListener("ended", stop);
    video.removeEventListener("seeked", seeked);
    video.removeEventListener("loadeddata", stop);
  };
}
