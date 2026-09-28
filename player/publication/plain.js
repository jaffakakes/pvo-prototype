import { createPublicationSharing } from "./sharing.js";

/** A published flat video uses browser playback controls and owns no PVO runtime. */
export function mountPlainPublication({ publication, refs, title }) {
  const { video, frame, empty, shell, status } = refs;
  const listeners = new AbortController();
  const on = (element, event, handler) => element?.addEventListener(event, handler, { signal: listeners.signal });
  const setStatus = (message, error = false, visible = error) => {
    status.textContent = message;
    status.classList.toggle("error", error);
    status.classList.toggle("is-visible", Boolean(message) && visible);
  };
  const sharing = createPublicationSharing({
    publication, buttons: [refs.share, refs.endShare], title, setStatus,
  });
  const loaded = () => {
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      const aspect = video.videoWidth / video.videoHeight;
      frame.style.setProperty("--aspect", String(aspect));
      frame.style.aspectRatio = String(aspect);
    }
    setStatus("");
  };
  const failed = () => {
    video.pause();
    empty.hidden = false;
    shell.hidden = true;
    setStatus("");
  };
  const dispose = () => {
    listeners.abort();
    sharing.destroy();
    video.pause();
    video.removeAttribute("src");
    video.load();
  };

  refs.controls.hidden = true;
  refs.centerPlay.hidden = true;
  refs.endScreen.hidden = true;
  refs.overlay.hidden = true;
  frame.dataset.publicationFormat = "video";
  frame.classList.add("controls-visible");
  empty.hidden = true;
  shell.hidden = false;
  video.controls = true;
  video.preload = "metadata";
  video.setAttribute("aria-label", title);
  setStatus("Loading…", false, true);
  on(video, "loadedmetadata", loaded);
  on(video, "canplay", () => setStatus(""));
  on(video, "playing", () => setStatus(""));
  on(video, "waiting", () => setStatus("Loading…", false, true));
  on(video, "error", failed);
  on(refs.share, "click", () => { void sharing.share(); });
  on(window, "pagehide", event => { if (!event.persisted) dispose(); });
  video.src = publication.mediaUrl;
  video.load();
  return { destroy: dispose };
}
