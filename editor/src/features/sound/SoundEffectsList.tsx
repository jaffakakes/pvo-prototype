import { useState } from "react";
import { SOUND_EFFECTS } from "../../domain/audio/soundEffects";
import { previewEffect } from "../../infrastructure/audio/effectPreview";
import { soundEffectBlob } from "../../infrastructure/audio/soundEffect";
import { insertAudioClip } from "../../state/editing/audioCommands";
import { useCapture } from "../../state/captureStore";
import { notify } from "../../state/notifications/notificationStore";
import { SoundPicker } from "./SoundPicker";
import { useSoundPreview } from "./useSoundPreview";

export function SoundEffectsList({ query = "" }: { query?: string }) {
  const [selected, setSelected] = useState<string | null>(null);
  const preview = useSoundPreview();
  const effects = SOUND_EFFECTS.filter((effect) =>
    effect.name.toLowerCase().includes(query.toLowerCase()),
  );
  const rows = effects.map((effect) => ({
    ...effect,
    by: "Sound effect",
    len: `${effect.seconds}s`,
  }));
  return (
    <SoundPicker
      rows={rows}
      selected={effects.findIndex((effect) => effect.id === selected)}
      onSelect={(index) => {
        setSelected(effects[index].id);
        preview(() =>
          previewEffect(soundEffectBlob(effects[index]), () =>
            notify("audioPreviewFailed"),
          ),
        );
      }}
      onAdd={(index) => {
        const effect = effects[index];
        const url = URL.createObjectURL(soundEffectBlob(effect));
        const state = useCapture.getState();
        if (
          !insertAudioClip(
            {
              name: effect.name,
              url,
              duration: effect.seconds,
              start: state.t,
            },
            state,
          )
        )
          URL.revokeObjectURL(url);
      }}
    />
  );
}
