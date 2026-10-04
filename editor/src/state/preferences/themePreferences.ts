import { create } from "zustand";
import {
  DEFAULT_THEME_ACCENT,
  isThemeAccent,
  isThemeMode,
  type ThemeAccent,
  type ThemeMode,
} from "../../domain/appearance/theme";
import {
  readThemeAccent,
  readThemeMode,
  saveThemeAccent,
  saveThemeMode,
} from "../../infrastructure/preferences/theme";

type ThemePreferences = {
  mode: ThemeMode;
  accent: ThemeAccent;
  userId: string | null;
  storageSaveFailed: boolean;
  modeStorageFailed: boolean;
  accentStorageFailed: boolean;
};

const initialMode = readThemeMode();

// UI appearance is outside project snapshots and editing history.
export const useThemePreferences = create<ThemePreferences>(() => ({
  mode: initialMode.value,
  accent: DEFAULT_THEME_ACCENT,
  userId: null,
  storageSaveFailed: initialMode.failed,
  modeStorageFailed: initialMode.failed,
  accentStorageFailed: false,
}));

export function setThemeMode(mode: ThemeMode): void {
  if (!isThemeMode(mode)) return;
  const saved = saveThemeMode(mode);
  useThemePreferences.setState(state => ({
    mode,
    modeStorageFailed: !saved,
    storageSaveFailed: !saved || state.accentStorageFailed,
  }));
}

export function setThemeAccent(accent: ThemeAccent): void {
  if (!isThemeAccent(accent)) return;
  const { userId } = useThemePreferences.getState();
  if (userId === null) return;
  const saved = saveThemeAccent(userId, accent);
  useThemePreferences.setState(state => ({
    accent,
    accentStorageFailed: !saved,
    storageSaveFailed: state.modeStorageFailed || !saved,
  }));
}

/** Apply the verified account identity; a guest never inherits an account accent. */
export function syncThemeAccount(userId: string | null): void {
  const current = useThemePreferences.getState();
  if (current.userId === userId) return;
  const stored = userId === null ? { value: DEFAULT_THEME_ACCENT, failed: false } : readThemeAccent(userId);
  useThemePreferences.setState({
    userId,
    accent: stored.value,
    accentStorageFailed: stored.failed,
    storageSaveFailed: current.modeStorageFailed || stored.failed,
  });
}
