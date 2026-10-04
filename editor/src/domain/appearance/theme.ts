export const THEME_MODES = ["system", "light", "dark"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

export const THEME_ACCENTS = ["magenta", "orange", "emerald", "cyan", "blue", "violet"] as const;
export type ThemeAccent = (typeof THEME_ACCENTS)[number];

export const DEFAULT_THEME_MODE: ThemeMode = "system";
export const DEFAULT_THEME_ACCENT: ThemeAccent = "magenta";

export function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === "string" && THEME_MODES.some(mode => mode === value);
}

export function isThemeAccent(value: unknown): value is ThemeAccent {
  return typeof value === "string" && THEME_ACCENTS.some(accent => accent === value);
}

export function accentForAccount(userId: string | null, savedAccent: unknown): ThemeAccent {
  return userId !== null && isThemeAccent(savedAccent) ? savedAccent : DEFAULT_THEME_ACCENT;
}
