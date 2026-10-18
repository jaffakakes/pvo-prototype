import { useEffect, useRef, useState } from "react";
import { createMusicPlayer } from "../../infrastructure/audio/musicPlayer";
import { notify } from "../../state/notifications/notificationStore";

/** Auditioning owns its audio independently of the project and its playback clock. */
export function useMusicPreview() {
  const [selected, setSelected] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const player = useRef<ReturnType<typeof createMusicPlayer> | null>(null);
  const position = useRef({ track: 0, time: 0, started: 0, playing: false });
  useEffect(() => () => player.current?.dispose(), []);

  const sync = (track: number, play: boolean) => {
    const current = position.current;
    let time = current.time;
    if (current.playing) time += (performance.now() - current.started) / 1000;
    if (track !== current.track) time = 0;
    position.current = {
      track,
      time,
      started: performance.now(),
      playing: play,
    };
    if (!player.current)
      player.current = createMusicPlayer((error) => {
        console.warn("Sound library preview failed:", error);
        position.current.playing = false;
        setPlaying(false);
        notify("audioPreviewFailed");
      });
    player.current.sync({
      sceneId: "sound-library",
      track,
      time,
      playing: play,
      volume: 1,
    });
    setSelected(track);
    setPlaying(play);
  };
  return {
    selected,
    playing,
    select: (track: number) => sync(track, track !== selected || !playing),
    toggle: () => {
      if (selected !== null) sync(selected, !playing);
    },
  };
}
