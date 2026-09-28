import { useEffect } from "react";
import { createAudioLayerPlayer } from "../../infrastructure/audio/audioLayerPlayer";
import { useCapture } from "../../state/captureStore";
import {
  clearNotificationScope,
  notify,
} from "../../state/notifications/notificationStore";

export function useAudioPlayback() {
  useEffect(() => {
    const player = createAudioLayerPlayer((error) => {
      console.warn("Audio layer preview failed:", error);
      useCapture.getState().patch({ playing: false });
      notify("audioPreviewFailed", {
        scope: "audio-preview",
        currentAttempt: true,
      });
    });
    const sync = () => {
      const state = useCapture.getState();
      player.sync(state.audioClips, state.t, state.playing && !state.trim);
    };
    sync();
    const unsubscribe = useCapture.subscribe(sync);
    return () => {
      unsubscribe();
      player.dispose();
      clearNotificationScope("audio-preview");
    };
  }, []);
}
