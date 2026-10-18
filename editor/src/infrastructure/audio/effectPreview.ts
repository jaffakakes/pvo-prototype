export function previewEffect(blob: Blob, onError: () => void): () => void {
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  let released = false;
  const stop = () => {
    if (released) return;
    released = true;
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    URL.revokeObjectURL(url);
  };
  const failed = () => {
    if (released) return;
    stop();
    onError();
  };
  audio.onended = stop;
  audio.onerror = failed;
  void audio.play().catch(failed);
  return stop;
}
