import { useId, useState } from "react";
import type { Ratio } from "../../domain/project/model";
import { RATIOS } from "../../domain/project/ratio";
import { resetComponentLook } from "../../domain/components/look";
import { isVisualEditingBlocked } from "../../domain/components/codeOwnership";
import { editComponentLook } from "../../domain/components/languageLook";
import { useCapture } from "../../state/captureStore";
import {
  setAdvancedEditingEnabled,
  setReduceMotion,
  useEditorPreferences,
} from "../../state/preferences/editorPreferences";
import { SceneSettings } from "../scenes/SceneSettings";
import { AdvancedSettings } from "./AdvancedSettings";
import { ProjectStorageStatus } from "./ProjectStorageStatus";
import { CaptureRecovery } from "../capture/CaptureRecovery";
import { ServicesPanel } from "../services/ServicesPanel";
import { ReplyInbox } from "../replies/ReplyInbox";
import styles from "./MoreSettings.module.css";
import { requestExport } from "../../state/export/exportCommands";
import { openSignIn, useAuthGate } from "../../state/auth/authGateStore";
import {
  THEME_ACCENTS,
  THEME_MODES,
  type ThemeAccent,
  type ThemeMode,
} from "../../domain/appearance/theme";
import {
  setThemeAccent,
  setThemeMode,
  useThemePreferences,
} from "../../state/preferences/themePreferences";

const ratios = Object.keys(RATIOS) as Ratio[];
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

export function MoreSettings() {
  const user = useAuthGate((state) => state.user);
  const ratio = useCapture((state) => state.ratio);
  const edit = useCapture((state) => state.edit);
  const advancedEditingEnabled = useEditorPreferences(
    (state) => state.advancedEditingEnabled,
  );
  const reduceMotion = useEditorPreferences((state) => state.reduceMotion);
  const themeMode = useThemePreferences((state) => state.mode);
  const themeAccent = useThemePreferences((state) => state.accent);
  const themeSaveFailed = useThemePreferences(
    (state) => state.storageSaveFailed,
  );
  const currentSceneId = useCapture((state) => state.currentSceneId);
  const screen = useCapture((state) => state.screen);
  const storageSaveFailed = useEditorPreferences(
    (state) => state.storageSaveFailed,
  );
  const component = useCapture((state) =>
    state.components.find((item) => item.id === state.selComp),
  );
  const advancedLabelId = useId();
  const advancedHelpId = useId();
  const [appearanceError, setAppearanceError] = useState<string | null>(null);
  const [showReplies, setShowReplies] = useState(false);
  const repliesId = useId();
  const servicesId = useId();
  const [showServices, setShowServices] = useState(false);

  return (
    <div className={styles.content}>
      <section className={styles.section} aria-label="Account">
        <h3>Account</h3>
        <div className={styles.actions}>
          <button type="button" onClick={() => openSignIn()}>
            {user ? "Your account" : "Sign in"}
          </button>
        </div>
      </section>
      <section
        className={styles.section}
        aria-labelledby="more-appearance-heading"
      >
        <h3 id="more-appearance-heading">Appearance</h3>
        <p className={styles.themeHelp}>
          Choose how the editor looks on this device.
        </p>
        <div className={styles.themeModes} role="group" aria-label="Color mode">
          {THEME_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={themeMode === mode}
              data-selected={themeMode === mode}
              onClick={() => setThemeMode(mode)}
            >
              {modeLabels[mode]}
            </button>
          ))}
        </div>
        <h4 className={styles.themeSubheading}>Accent color</h4>
        {user ? (
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
        ) : (
          <p className={styles.themeHelp}>
            Magenta is the guest color. Sign in to choose another.
          </p>
        )}
        {themeSaveFailed && (
          <p className={styles.preferenceNote} role="status">
            Couldn’t save this appearance setting. It still applies to this
            session.
          </p>
        )}
      </section>
      {component && (
        <section className={styles.section} aria-label="Selected component">
          <div className={styles.actions}>
            <button
              type="button"
              onClick={() => {
                const state = useCapture.getState();
                state.duplicateComponent(component.id);
                state.patch({ sheet: "component" });
              }}
            >
              Duplicate component
            </button>
            <button
              type="button"
              disabled={isVisualEditingBlocked(component)}
              onClick={() => {
                try {
                  useCapture
                    .getState()
                    .updateComponent(
                      component.id,
                      editComponentLook(
                        component,
                        resetComponentLook(component),
                        { replace: true },
                      ),
                      true,
                    );
                  setAppearanceError(null);
                } catch (failure) {
                  setAppearanceError(
                    failure instanceof Error
                      ? failure.message
                      : "Couldn't reset this appearance.",
                  );
                }
              }}
            >
              Reset appearance
            </button>
            <button
              type="button"
              className={styles.deleteAction}
              onClick={() => {
                const state = useCapture.getState();
                state.deleteComponent(component.id);
                state.patch({ sheet: null });
              }}
            >
              Delete component
            </button>
          </div>
          {appearanceError && (
            <p className={styles.preferenceNote} role="alert">
              {appearanceError}
            </p>
          )}
        </section>
      )}
      {screen === "editor" && <SceneSettings key={currentSceneId} />}
      <section className={styles.section} aria-labelledby="more-ratio-heading">
        <h3 id="more-ratio-heading">Ratio</h3>
        <div className={styles.ratios} role="group" aria-label="Video ratio">
          {ratios.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={ratio === option}
              data-on={ratio === option}
              onClick={() => {
                if (ratio !== option) edit({ ratio: option });
              }}
            >
              <i data-ratio={option} aria-hidden="true" />
              <span>{option}</span>
            </button>
          ))}
        </div>
      </section>
      <section className={styles.section} aria-labelledby={advancedLabelId}>
        <div className={styles.preferenceRow}>
          <div className={styles.preferenceCopy}>
            <h3 id={advancedLabelId}>Advanced editing</h3>
            <p id={advancedHelpId}>
              Show Structure, Style and Logic alongside the visual tools.
            </p>
          </div>
          <button
            className={styles.preferenceSwitch}
            type="button"
            role="switch"
            aria-checked={advancedEditingEnabled}
            aria-labelledby={advancedLabelId}
            aria-describedby={advancedHelpId}
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
      <section className={styles.section}>
        <div className={styles.preferenceRow}>
          <div className={styles.preferenceCopy}>
            <h3 id="reduce-motion-heading">Reduce motion</h3>
            <p>Use cuts when opening panels and switching scenes.</p>
          </div>
          <button
            className={styles.preferenceSwitch}
            type="button"
            role="switch"
            aria-checked={reduceMotion}
            aria-labelledby="reduce-motion-heading"
            onClick={() => setReduceMotion(!reduceMotion)}
          >
            <span className={styles.switchTrack} aria-hidden="true">
              <span className={styles.switchThumb} />
            </span>
          </button>
        </div>
      </section>
      <section className={styles.section} aria-label="Replies">
        <h3>Replies</h3>
        <div className={styles.actions}>
          <button
            type="button"
            aria-expanded={showReplies}
            aria-controls={repliesId}
            onClick={() => setShowReplies(!showReplies)}
          >
            {showReplies ? "Close replies" : "Open replies"}
          </button>
        </div>
        {showReplies && (
          <div id={repliesId}>
            <ReplyInbox />
          </div>
        )}
      </section>
      <section className={styles.section} aria-label="Containers">
        <h3>Containers</h3>
        <div className={styles.actions}>
          <button
            type="button"
            aria-expanded={showServices}
            aria-controls={servicesId}
            onClick={() => setShowServices(!showServices)}
          >
            {showServices ? "Close Containers" : "Open Containers"}
          </button>
        </div>
        {showServices && (
          <div id={servicesId}>
            <ServicesPanel key={user?.id ?? "signed-out"} />
          </div>
        )}
      </section>
      {screen === "editor" && (
        <section
          className={styles.section}
          aria-labelledby="more-export-heading"
        >
          <h3 id="more-export-heading">Export</h3>
          <div className={styles.actions}>
            <button type="button" onClick={() => requestExport()}>
              Export and create link
            </button>
          </div>
          <p className={styles.exportNote}>
            The shared PVO keeps every scene and interactive component.
          </p>
        </section>
      )}
      {advancedEditingEnabled && <AdvancedSettings />}
      <ProjectStorageStatus onlyIssues />
      <CaptureRecovery />
    </div>
  );
}
