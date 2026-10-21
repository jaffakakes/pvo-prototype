import { SOUND_EFFECTS } from "../../domain/audio/soundEffects";
import { soundEffectBlob } from "../../infrastructure/audio/soundEffect";
import { useCapture } from "../../state/captureStore";
import { insertAudioClip } from "../../state/editing/audioCommands";

/** History owns an accepted URL; rejected insertions release it here. */
export function addSoundEffect(id: string): boolean {
  const effect = SOUND_EFFECTS.find((effect) => effect.id === id);
  if (!effect) return false;
  const url = URL.createObjectURL(soundEffectBlob(effect));
  let accepted = false;
  try {
    const state = useCapture.getState();
    accepted = insertAudioClip(
      {
        name: effect.name,
        url,
        duration: effect.seconds,
        start: state.t,
      },
      state,
    );
    return accepted;
  } finally {
    if (!accepted) URL.revokeObjectURL(url);
  }
}
