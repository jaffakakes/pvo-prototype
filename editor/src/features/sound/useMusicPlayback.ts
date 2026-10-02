import { evaluateAnimation } from "../../../../packages/pvo-animation/index.js";
import { audioGain } from "../../domain/audio/gain";
import { useEffect } from "react";
import { createMusicPlayer } from "../../infrastructure/audio/musicPlayer";
import { useCapture } from "../../state/captureStore";
import { clearNotificationScope, notify } from "../../state/notifications/notificationStore";

export function useMusicPlayback() {
  useEffect(() => {
    const player = createMusicPlayer(error => {
      console.warn("Music preview failed:", error);
      useCapture.getState().patch({ playing: false });
      notify("audioPreviewFailed", { scope: "music-preview", currentAttempt: true });
    });
    const sync = () => {
      const state = useCapture.getState();
      const scene = state.scenes.find(item => item.id === state.currentSceneId);
      player.sync({ sceneId: state.currentSceneId, track: state.sound, volume: audioGain(scene?.musicGain) * evaluateAnimation(scene?.musicAnimation, state.t).gain,
        time: state.t, playing: state.playing && !state.trim && state.ex !== "running" });
    };
    sync();
    const unsubscribe = useCapture.subscribe(sync);
    return () => {
      unsubscribe();
      player.dispose();
      clearNotificationScope("music-preview");
    };
  }, []);
}
