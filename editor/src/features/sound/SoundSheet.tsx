import { useState } from "react";
import { previewSound } from "../../infrastructure/audio/sound";
import { useCapture } from "../../state/captureStore";
import { Shell } from "../../ui/SheetShell";
import { SOUNDS } from "./catalog";
import { AnimateEntry } from "../animation/AnimateEntry";
import { SoundPicker } from "./SoundPicker";
import { useSoundPreview } from "./useSoundPreview";

export function SoundSheet() {
  const soundIndex = useCapture((state) => state.sound);
  const [title] = useState(() =>
    soundIndex > 0 ? "Replace sound" : "Add sound",
  );
  const preview = useSoundPreview();
  return (
    <Shell
      title={title}
      actions={soundIndex > 0 ? <AnimateEntry music /> : undefined}
    >
      <SoundPicker
        rows={SOUNDS}
        selected={soundIndex}
        onSelect={(index) => {
          const state = useCapture.getState();
          if (state.sound !== index) state.edit({ sound: index });
          preview(() => previewSound(index));
        }}
      />
    </Shell>
  );
}
