export const SOUND_EFFECTS = [
  { id: "pop", name: "Pop", seconds: 0.24, color: "#FF758F" },
  { id: "ding", name: "Ding", seconds: 1, color: "#FFD23E" },
  { id: "whoosh", name: "Whoosh", seconds: 0.65, color: "#2EC4B6" },
  { id: "click", name: "Click", seconds: 0.12, color: "#A78BFA" },
  { id: "chime", name: "Chime", seconds: 1.2, color: "#86B9F5" },
  { id: "drum", name: "Drum hit", seconds: 0.5, color: "#F5A66C" },
] as const;

export type SoundEffect = (typeof SOUND_EFFECTS)[number];
export const EFFECT_SAMPLE_RATE = 44100;

/** Original synthesized effects, with short fades to avoid clicks at their edges. */
export function soundEffectSamples(effect: SoundEffect): Float32Array {
  const samples = new Float32Array(
    Math.round(effect.seconds * EFFECT_SAMPLE_RATE),
  );
  for (let i = 0; i < samples.length; i++) {
    const t = i / EFFECT_SAMPLE_RATE;
    const progress = t / effect.seconds;
    const noise = Math.sin(i * 17.39) * Math.sin(i * 3.71);
    let value: number;
    switch (effect.id) {
      case "pop":
        value =
          Math.sin(2 * Math.PI * (600 * t - 850 * t * t)) * Math.exp(-t * 24);
        break;
      case "ding":
        value =
          (Math.sin(2 * Math.PI * 880 * t) +
            0.3 * Math.sin(2 * Math.PI * 1760 * t)) *
          Math.exp(-t * 5);
        break;
      case "whoosh":
        value = noise * Math.sin(Math.PI * progress) ** 2;
        break;
      case "click":
        value = noise * Math.exp(-t * 90);
        break;
      case "chime": {
        const notes = [659.25, 830.61, 987.77];
        value =
          notes.reduce((sum, hz, n) => {
            const local = t - n * 0.12;
            return (
              sum +
              (local < 0
                ? 0
                : Math.sin(2 * Math.PI * hz * local) * Math.exp(-local * 5))
            );
          }, 0) / 2;
        break;
      }
      case "drum":
        value =
          Math.sin(2 * Math.PI * (95 * t - 65 * t * t)) * Math.exp(-t * 13) +
          noise * 0.1 * Math.exp(-t * 50);
        break;
    }
    const fade = Math.min(1, t / 0.003, (effect.seconds - t) / 0.02);
    samples[i] = Math.max(-1, Math.min(1, value * fade * 0.65));
  }
  return samples;
}
