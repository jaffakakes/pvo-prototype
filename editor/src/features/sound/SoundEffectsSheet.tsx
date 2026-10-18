import { Shell } from "../../ui/SheetShell";
import { SoundEffectsList } from "./SoundEffectsList";

export function SoundEffectsSheet() {
  return (
    <Shell
      title="Sound effects"
      sub="Preview a sound, then add it at the playhead"
    >
      <SoundEffectsList />
    </Shell>
  );
}
