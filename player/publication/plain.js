import { bindPlaybackInputs } from "../ui/input.js";
import { createPlaybackSession } from "../playback/session.js";
import { createPlayerControls } from "../ui/controls.js";
import { createPlayerLayout } from "../ui/layout.js";

/** Flat publications use the same viewer chrome without instantiating a PVO runtime. */
export function mountPlainPublication({ publication, refs, title }) {
  const { video, frame, empty, shell } = refs;
  const session = createPlaybackSession();
  const listeners = new AbortController();
  const on = (element, event, handler) => element?.addEventListener(event, handler, { signal: listeners.signal });
  const controls = createPlayerControls({
    session, refs, publication,
    adapters: {
      timelineDuration: () => video.duration,
      updateLayout: () => layout.update(),
      restartExperience: async () => {
        session.finished = false;
        video.currentTime = 0;
        controls.updateProgress();
        try { await video.play(); }
        catch { controls.setStatus("Playback could not start.", true); }
      },
    },
  });
  const layout = createPlayerLayout({ refs, session });
  const loaded = () => {
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      frame.style.setProperty("--aspect", String(video.videoWidth / video.videoHeight));
    }
    controls.setStatus("");
  };
  const failed = () => {
    video.pause();
    empty.hidden = false;
    shell.hidden = true;
    controls.setStatus("");
  };
  const dispose = () => {
    listeners.abort();
    controls.destroy();
    layout.destroy();
    video.pause();
    video.removeAttribute("src");
    video.load();
  };

  refs.overlay.hidden = true;
  frame.dataset.publicationFormat = "video";
  empty.hidden = true;
  shell.hidden = false;
  video.controls = false;
  video.muted = true;
  video.preload = "auto";
  video.setAttribute("aria-label", title);
  if (publication.posterUrl) video.poster = publication.posterUrl;
  controls.setStatus("Loading…", false, true);
  on(video, "loadedmetadata", loaded);
  on(video, "canplay", () => controls.setStatus(""));
  on(video, "playing", () => controls.setStatus(""));
  on(video, "waiting", () => controls.setStatus("Loading…", false, true));
  on(video, "error", failed);
  for (const event of ["play", "pause", "volumechange", "durationchange"]) on(video, event, controls.updateProgress);
  on(video, "ended", () => { session.finished = true; controls.updateProgress(); });
  on(refs.endRestart, "click", controls.togglePlayback);
  bindPlaybackInputs({ refs, commands: controls, signal: listeners.signal });

  on(window, "pagehide", event => { if (!event.persisted) dispose(); });
  video.src = publication.mediaUrl;
  video.load();
  if (document.body.dataset.autoplay !== "false") {
    void video.play().catch(() => { controls.setStatus(""); });
  }
  return { destroy: dispose };
}
