import { audioDuration } from "../../domain/audio/editing";
import type { AudioClip } from "../../domain/audio/model";

type Entry = {
  media: HTMLAudioElement;
  source?: MediaElementAudioSourceNode;
  ready: Promise<void>;
  error: Error | null;
  pending: boolean;
  dispose(): void;
};

/** Owns source media elements for independently timed audio layers. */
export function createAudioLayerPlayer(
  onError: (error: Error) => void,
  output?: { context: AudioContext; destination: AudioNode },
) {
  const entries = new Map<number, Entry>();
  let current: { clips: AudioClip[]; time: number; playing: boolean } = {
    clips: [],
    time: 0,
    playing: false,
  };

  function create(clip: AudioClip): Entry {
    const media = new Audio();
    media.preload = "auto";
    media.dataset.audioLayer = String(clip.id);
    const source = output?.context.createMediaElementSource(media);
    source?.connect(output!.destination);
    let finish: () => void = () => {};
    const entry: Entry = {
      media,
      source,
      error: null,
      pending: false,
      ready: new Promise<void>((resolve) => {
        finish = resolve;
      }),
      dispose: () => {
        clearTimeout(timeout);
        media.removeEventListener("loadedmetadata", loaded);
        media.removeEventListener("error", failed);
        media.pause();
        source?.disconnect();
        media.removeAttribute("src");
        media.load();
        finish();
      },
    };
    const fail = () => {
      if (entry.error) return;
      entry.error = new Error(`Could not play extracted audio: ${clip.name}`);
      clearTimeout(timeout);
      finish();
      onError(entry.error);
    };
    const failed = () => fail();
    const loaded = () => {
      clearTimeout(timeout);
      finish();
      sync(current.clips, current.time, current.playing);
    };
    const timeout = window.setTimeout(fail, 15000);
    media.addEventListener("loadedmetadata", loaded, { once: true });
    media.addEventListener("error", failed);
    media.src = clip.url!;
    media.load();
    return entry;
  }

  function sync(clips: AudioClip[], time: number, playing: boolean) {
    current = { clips, time, playing };
    for (const [id, entry] of entries) {
      if (
        !clips.some(
          (clip) =>
            clip.id === id && clip.url === entry.media.getAttribute("src"),
        )
      ) {
        entry.dispose();
        entries.delete(id);
      }
    }
    for (const clip of clips) {
      if (!clip.url) continue;
      let entry = entries.get(clip.id);
      if (!entry) {
        entry = create(clip);
        entries.set(clip.id, entry);
      }
      const media = entry.media;
      const audible =
        playing &&
        !clip.muted &&
        time >= clip.start &&
        time < clip.start + audioDuration(clip);
      media.muted = clip.muted;
      media.playbackRate = clip.speed;
      if (!audible) media.pause();
      if (media.readyState < HTMLMediaElement.HAVE_METADATA || entry.error)
        continue;
      const target = Math.min(
        clip.out,
        clip.in + Math.max(0, time - clip.start) * clip.speed,
      );
      if (Math.abs(media.currentTime - target) > (audible ? 0.12 : 0.015))
        media.currentTime = target;
      if (audible && media.paused && !entry.pending) {
        const active = entry;
        active.pending = true;
        void media
          .play()
          .catch((error) => {
            if (error?.name === "AbortError" || !current.playing) return;
            active.error = new Error(
              `Could not start extracted audio: ${clip.name}`,
              { cause: error },
            );
            onError(active.error);
          })
          .finally(() => {
            active.pending = false;
          });
      }
    }
  }

  return {
    sync,
    async prepare(clips: AudioClip[]) {
      if (clips.some((clip) => !clip.url))
        throw new Error("Extracted audio source is missing.");
      sync(clips, 0, false);
      await Promise.all([...entries.values()].map((entry) => entry.ready));
      const failed = [...entries.values()].find((entry) => entry.error);
      if (failed) throw failed.error;
    },
    pause() {
      sync(current.clips, current.time, false);
    },
    dispose() {
      current = { clips: [], time: 0, playing: false };
      for (const entry of entries.values()) entry.dispose();
      entries.clear();
    },
  };
}
