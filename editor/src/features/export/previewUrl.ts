type PreviewLoader = (
  signal: AbortSignal,
) => Blob | null | Promise<Blob | null>;

/** A preview owns its URL; an obsolete async result must never replace the current view. */
export function ownPreviewUrl(
  load: PreviewLoader,
  ready: (url: string | null) => void,
  failed: (error: unknown) => void,
): () => void {
  const controller = new AbortController();
  let url: string | null = null;
  void Promise.resolve()
    .then(() => {
      controller.signal.throwIfAborted();
      return load(controller.signal);
    })
    .then((blob) => {
      if (controller.signal.aborted) return;
      url = blob ? URL.createObjectURL(blob) : null;
      ready(url);
    })
    .catch((error) => {
      if (!controller.signal.aborted) failed(error);
    });
  return () => {
    controller.abort();
    if (url) URL.revokeObjectURL(url);
    url = null;
  };
}
