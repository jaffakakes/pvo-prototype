import { Shell } from "../../ui/SheetShell";
import { SOUND_EFFECTS } from "../../domain/audio/soundEffects";
import { addSoundEffect } from "./addSoundEffect";
import { SoundBrowser } from "./SoundBrowser";
import { useSoundEffectPreview } from "./useSoundEffectPreview";

const effects = SOUND_EFFECTS.map((effect) => ({
  ...effect,
  by: "Sound effect",
  len: `${effect.seconds}s`,
}));

export function SoundEffectsSheet() {
  const preview = useSoundEffectPreview();
  return (
    <Shell title="Sound effects" headerless>
      <SoundBrowser
        sounds={effects}
        preview={preview}
        onUse={addSoundEffect}
        // Short effects finish before a bookmark can be pressed.
        inlineUse={false}
      />
    </Shell>
  );
}
