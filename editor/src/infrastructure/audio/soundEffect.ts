import {
  EFFECT_SAMPLE_RATE,
  soundEffectSamples,
  type SoundEffect,
} from "../../domain/audio/soundEffects";
import { monoWav } from "./wav";

export function soundEffectBlob(effect: SoundEffect): Blob {
  return new Blob([monoWav(soundEffectSamples(effect), EFFECT_SAMPLE_RATE)], {
    type: "audio/wav",
  });
}
