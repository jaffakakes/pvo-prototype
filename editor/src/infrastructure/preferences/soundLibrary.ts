export type SoundLibraryPreferences = { saved: string[]; recent: string[] };
const KEY = "restyle.editor.soundLibrary";

export function readSoundLibrary(): {
  value: SoundLibraryPreferences;
  failed: boolean;
} {
  try {
    const parsed: unknown = JSON.parse(
      globalThis.localStorage.getItem(KEY) ?? "{}",
    );
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("Invalid sound library preferences.");
    const value = parsed as Record<string, unknown>;
    const names = (items: unknown): string[] =>
      Array.isArray(items)
        ? [
            ...new Set(
              items.filter(
                (item): item is string =>
                  typeof item === "string" &&
                  item.length > 0 &&
                  item.length <= 120,
              ),
            ),
          ].slice(0, 40)
        : [];
    return {
      value: { saved: names(value?.saved), recent: names(value?.recent) },
      failed: false,
    };
  } catch {
    return { value: { saved: [], recent: [] }, failed: true };
  }
}

export function saveSoundLibrary(value: SoundLibraryPreferences): boolean {
  try {
    globalThis.localStorage.setItem(KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
