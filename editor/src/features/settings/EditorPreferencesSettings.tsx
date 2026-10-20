import { useId } from "react";
import {
  THEME_ACCENTS,
  THEME_MODES,
  type ThemeAccent,
  type ThemeMode,
} from "../../domain/appearance/theme";
import { useAuthGate } from "../../state/auth/authGateStore";
import {
  setThemeAccent,
  setThemeMode,
  useThemePreferences,
} from "../../state/preferences/themePreferences";
import {
  setAdvancedEditingEnabled,
  useEditorPreferences,
} from "../../state/preferences/editorPreferences";
import { Icon } from "../../ui/Icon";
import styles from "./MoreSettings.module.css";

const modeLabels: Record<ThemeMode, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};
const accentLabels: Record<ThemeAccent, string> = {
  magenta: "Magenta",
  orange: "Orange",
  emerald: "Emerald",
  cyan: "Cyan",
  blue: "Blue",
  violet: "Violet",
};

const modeIcons: Record<ThemeMode, string> = {
  system: "desktop",
  light: "sun",
  dark: "moon",
};

export function AppearanceSettings({
  iconOnly = false,
}: {
  iconOnly?: boolean;
}) {
  const appearanceId = useId();
  const user = useAuthGate((state) => state.user);
  const themeMode = useThemePreferences((state) => state.mode);
  const themeAccent = useThemePreferences((state) => state.accent);
  const themeSaveFailed = useThemePreferences(
    (state) => state.storageSaveFailed,
  );
  return (
    <section className={styles.section} aria-labelledby={appearanceId}>
      <h3 id={appearanceId}>Appearance</h3>
      {!iconOnly && (
        <p className={styles.themeHelp}>
          Choose how the editor looks on this device.
        </p>
      )}
      <div
        className={`${styles.themeModes} ${iconOnly ? styles.iconModes : ""}`}
        role="group"
        aria-label="Color mode"
      >
        {THEME_MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            aria-label={modeLabels[mode]}
            title={modeLabels[mode]}
            aria-pressed={themeMode === mode}
            data-selected={themeMode === mode}
            onClick={() => setThemeMode(mode)}
          >
            {iconOnly ? (
              <Icon name={modeIcons[mode]} size={20} />
            ) : (
              modeLabels[mode]
            )}
          </button>
        ))}
      </div>
      {user && (
        <>
          <h4 className={styles.themeSubheading}>Accent color</h4>
          <div
            className={styles.themeAccents}
            role="group"
            aria-label="Accent color"
          >
            {THEME_ACCENTS.map((accent) => (
              <button
                key={accent}
                type="button"
                aria-label={accentLabels[accent]}
                aria-pressed={themeAccent === accent}
                data-selected={themeAccent === accent}
                data-accent={accent}
                onClick={() => setThemeAccent(accent)}
              >
                <span className={styles.themeSwatch} aria-hidden="true" />
                <span>{accentLabels[accent]}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {themeSaveFailed && (
        <p className={styles.preferenceNote} role="status">
          Couldn’t save this appearance setting. It still applies to this
          session.
        </p>
      )}
    </section>
  );
}

export function AdvancedEditingSetting({
  compact = false,
}: {
  compact?: boolean;
}) {
  const advancedLabelId = useId();
  const advancedHelpId = useId();
  const advancedEditingEnabled = useEditorPreferences(
    (state) => state.advancedEditingEnabled,
  );
  const storageSaveFailed = useEditorPreferences(
    (state) => state.storageSaveFailed,
  );
  return (
    <section className={styles.section} aria-labelledby={advancedLabelId}>
      <div className={styles.preferenceRow}>
        <div className={styles.preferenceCopy}>
          <h3 id={advancedLabelId}>Advanced edits</h3>
          {!compact && (
            <p id={advancedHelpId}>
              Show Structure, Style and Logic alongside the visual tools.
            </p>
          )}
        </div>
        <button
          className={styles.preferenceSwitch}
          type="button"
          role="switch"
          aria-checked={advancedEditingEnabled}
          aria-labelledby={advancedLabelId}
          aria-describedby={compact ? undefined : advancedHelpId}
          onClick={() => setAdvancedEditingEnabled(!advancedEditingEnabled)}
        >
          <span className={styles.switchTrack} aria-hidden="true">
            <span className={styles.switchThumb} />
          </span>
        </button>
      </div>
      {storageSaveFailed && (
        <p className={styles.preferenceNote} role="status">
          Couldn’t save this setting. It still applies to this session.
        </p>
      )}
    </section>
  );
}
