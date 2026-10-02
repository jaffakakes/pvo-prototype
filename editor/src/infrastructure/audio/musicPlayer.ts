import { audioGain } from "../../domain/audio/gain";
import { startSound } from "./sound";

type MusicPosition = { sceneId: string; track: number; volume: number; time: number; playing: boolean };

/** A preview owns one context; every restarted loop resumes at the authored scene time. */
export function createMusicPlayer(onError: (error: Error) => void) {
  let context: AudioContext | null = null;
  let gain: GainNode | null = null;
  let source: AudioBufferSourceNode | null = null;
  let active: { sceneId: string; track: number; time: number; clock: number } | null = null;
  let desired: MusicPosition | null = null;
  let pending = false;
  let disposed = false;

  const stop = () => {
    source?.stop();
    source = null;
    active = null;
  };
  const fail = (error: unknown) => {
    stop();
    if (!disposed && desired?.playing)
      onError(new Error("Could not play the scene's music.", { cause: error }));
  };

  return {
    sync(position: MusicPosition) {
      if (disposed) return;
      desired = position;
      if (!position.playing || position.track <= 0) {
        stop();
        if (context?.state === "running") void context.suspend().catch(fail);
        return;
      }
      try {
        if (!context) {
          context = new AudioContext();
          gain = context.createGain();
          gain.connect(context.destination);
        }
        gain!.gain.value = audioGain(position.volume);
        if (active && (active.sceneId !== position.sceneId || active.track !== position.track
          || Math.abs(position.time - active.time - (context.currentTime - active.clock)) > 0.2)) stop();
        if (source || pending) return;
        pending = true;
        const owner = context;
        void owner.resume().then(() => {
          if (disposed || context !== owner || !desired?.playing || desired.track <= 0) return;
          source = startSound(owner, desired.track, gain!, 1, desired.time);
          active = { sceneId: desired.sceneId, track: desired.track, time: desired.time, clock: owner.currentTime };
        }).catch(fail).finally(() => { pending = false; });
      } catch (error) { fail(error); }
    },
    dispose() {
      disposed = true;
      stop();
      gain?.disconnect();
      gain = null;
      void context?.close().catch(() => {});
      context = null;
    },
  };
}
