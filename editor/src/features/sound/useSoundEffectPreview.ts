import { useEffect, useRef, useState } from "react";
import { SOUND_EFFECTS } from "../../domain/audio/soundEffects";
import { createEffectPreview } from "../../infrastructure/audio/effectPreview";
import { soundEffectBlob } from "../../infrastructure/audio/soundEffect";
import { notify } from "../../state/notifications/notificationStore";

export function useSoundEffectPreview() {
  const [selected, setSelected] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const player = useRef<ReturnType<typeof createEffectPreview> | null>(null);
  useEffect(() => () => player.current?.dispose(), []);
  const toggle = () => {
    if (playing) player.current?.pause();
    else player.current?.play();
  };
  return {
    selected,
    playing,
    toggle,
    select(id: string) {
      if (id === selected && player.current) {
        toggle();
        return;
      }
      const effect = SOUND_EFFECTS.find((effect) => effect.id === id);
      if (!effect) return;
      player.current?.dispose();
      player.current = null;
      setSelected(id);
      setPlaying(false);
      try {
        player.current = createEffectPreview(
          soundEffectBlob(effect),
          setPlaying,
          () => {
            player.current = null;
            notify("audioPreviewFailed");
          },
        );
        player.current.play();
      } catch (error) {
        player.current?.dispose();
        player.current = null;
        setPlaying(false);
        console.warn("Sound effect preview failed:", effect.id, error);
        notify("audioPreviewFailed");
      }
    },
  };
}
