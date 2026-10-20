/** The picker owns the element and URL until replacement or dismissal. */
export function createEffectPreview(
  blob: Blob,
  onPlaying: (playing: boolean) => void,
  onError: () => void,
) {
  const audio = new Audio();
  const url = URL.createObjectURL(blob);
  audio.src = url;
  let disposed = false;
  let revision = 0;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    revision++;
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    URL.revokeObjectURL(url);
  };
  const failed = () => {
    if (disposed) return;
    dispose();
    onPlaying(false);
    onError();
  };
  audio.onended = () => {
    revision++;
    onPlaying(false);
  };
  audio.onerror = failed;
  return {
    play() {
      if (disposed) return;
      if (audio.ended) audio.currentTime = 0;
      const request = ++revision;
      onPlaying(true);
      void audio.play().catch(() => {
        if (request === revision) failed();
      });
    },
    pause() {
      if (disposed) return;
      revision++;
      audio.pause();
      onPlaying(false);
    },
    dispose,
  };
}
