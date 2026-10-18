import { SOUND_EFFECTS } from "../../domain/audio/soundEffects";
import { addSoundEffect } from "./addSoundEffect";
import { SoundPicker } from "./SoundPicker";
import { useSoundEffectPreview } from "./useSoundEffectPreview";

export function SoundEffectsList({ query = "" }: { query?: string }) {
  const preview = useSoundEffectPreview();
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
      selected={effects.findIndex((effect) => effect.id === preview.selected)}
      onSelect={(index) => preview.select(effects[index].id)}
      onAdd={(index) => {
        addSoundEffect(effects[index].id);
      }}
    />
  );
}
