import {
  accentForAccount,
  DEFAULT_THEME_ACCENT,
  DEFAULT_THEME_MODE,
  isThemeMode,
  type ThemeAccent,
  type ThemeMode,
} from "../../domain/appearance/theme";

const MODE_STORAGE_KEY = "restyle.editor.themeMode";
const ACCENT_STORAGE_PREFIX = "restyle.editor.themeAccent.";

type StoredTheme<T> = { value: T; failed: boolean };

function accentStorageKey(userId: string): string {
  return `${ACCENT_STORAGE_PREFIX}${encodeURIComponent(userId)}`;
}

export function readThemeMode(): StoredTheme<ThemeMode> {
  try {
    const stored = globalThis.localStorage.getItem(MODE_STORAGE_KEY);
    return { value: isThemeMode(stored) ? stored : DEFAULT_THEME_MODE, failed: false };
  } catch {
    return { value: DEFAULT_THEME_MODE, failed: true };
  }
}

export function saveThemeMode(mode: ThemeMode): boolean {
  try {
    globalThis.localStorage.setItem(MODE_STORAGE_KEY, mode);
    return true;
  } catch {
    return false;
  }
}

export function readThemeAccent(userId: string): StoredTheme<ThemeAccent> {
  try {
    return { value: accentForAccount(userId, globalThis.localStorage.getItem(accentStorageKey(userId))), failed: false };
  } catch {
    return { value: DEFAULT_THEME_ACCENT, failed: true };
  }
}

export function saveThemeAccent(userId: string, accent: ThemeAccent): boolean {
  try {
    globalThis.localStorage.setItem(accentStorageKey(userId), accent);
    return true;
  } catch {
    return false;
  }
}
