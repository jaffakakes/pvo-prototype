import { create } from "zustand";
import {
  readSoundLibrary,
  saveSoundLibrary,
  type SoundLibraryPreferences,
} from "../../infrastructure/preferences/soundLibrary";

const stored = readSoundLibrary();
export const useSoundLibrary = create<
  SoundLibraryPreferences & { storageSaveFailed: boolean }
>(() => ({
  ...stored.value,
  storageSaveFailed: stored.failed,
}));

function update(value: SoundLibraryPreferences) {
  const saved = saveSoundLibrary(value);
  useSoundLibrary.setState({ ...value, storageSaveFailed: !saved });
}

export function toggleSavedSound(name: string) {
  const { saved, recent } = useSoundLibrary.getState();
  update({
    recent,
    saved: saved.includes(name)
      ? saved.filter((item) => item !== name)
      : [name, ...saved].slice(0, 40),
  });
}

export function rememberUsedSound(name: string) {
  const { saved, recent } = useSoundLibrary.getState();
  update({
    saved,
    recent: [name, ...recent.filter((item) => item !== name)].slice(0, 40),
  });
}
