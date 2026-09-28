import { useId, useState } from "react";
import type { Ratio } from "../../domain/project/model";
import { RATIOS } from "../../domain/project/ratio";
import { resetComponentLook } from "../../domain/components/look";
import { isVisualEditingBlocked } from "../../domain/components/codeOwnership";
import { editComponentLook } from "../../domain/components/languageLook";
import { useCapture } from "../../state/captureStore";
import { setAdvancedEditingEnabled, setReduceMotion, useEditorPreferences } from "../../state/preferences/editorPreferences";
import { SceneSettings } from "../scenes/SceneSettings";
import { AdvancedSettings } from "./AdvancedSettings";
import { ProjectStorageStatus } from "./ProjectStorageStatus";
import { CaptureRecovery } from "../capture/CaptureRecovery";
import styles from "./MoreSettings.module.css";
import { requestExport } from "../../state/auth/authGateStore";

const ratios = Object.keys(RATIOS) as Ratio[];

export function MoreSettings() {
  const ratio = useCapture(state => state.ratio);
  const edit = useCapture(state => state.edit);
  const advancedEditingEnabled = useEditorPreferences(state => state.advancedEditingEnabled);
  const reduceMotion = useEditorPreferences(state => state.reduceMotion);
  const currentSceneId = useCapture(state => state.currentSceneId);
  const screen = useCapture(state => state.screen);
  const storageSaveFailed = useEditorPreferences(state => state.storageSaveFailed);
  const component = useCapture(state => state.components.find(item => item.id === state.selComp));
  const advancedLabelId = useId();
  const advancedHelpId = useId();
  const [appearanceError, setAppearanceError] = useState<string | null>(null);

  return <div className={styles.content}>
    {component && <section className={styles.section} aria-label="Selected component">
      <div className={styles.actions}>
        <button type="button" onClick={() => {
          const state = useCapture.getState();
          state.duplicateComponent(component.id);
          state.patch({ sheet: "component" });
        }}>Duplicate component</button>
        <button type="button" disabled={isVisualEditingBlocked(component)} onClick={() => {
          try {
            useCapture.getState().updateComponent(component.id,
              editComponentLook(component, resetComponentLook(component), { replace: true }), true);
            setAppearanceError(null);
          } catch (failure) {
            setAppearanceError(failure instanceof Error ? failure.message : "Couldn't reset this appearance.");
          }
        }}>Reset appearance</button>
        <button type="button" className={styles.deleteAction} onClick={() => {
          const state = useCapture.getState();
          state.deleteComponent(component.id);
          state.patch({ sheet: null });
        }}>Delete component</button>
      </div>
      {appearanceError && <p className={styles.preferenceNote} role="alert">{appearanceError}</p>}
    </section>}
    {screen === "editor" && <SceneSettings key={currentSceneId} />}
    <section className={styles.section} aria-labelledby="more-ratio-heading">
      <h3 id="more-ratio-heading">Ratio</h3>
      <div className={styles.ratios} role="group" aria-label="Video ratio">
        {ratios.map(option => <button
          key={option}
          type="button"
          aria-pressed={ratio === option}
          data-on={ratio === option}
          onClick={() => { if (ratio !== option) edit({ ratio: option }); }}
        >
          <i data-ratio={option} aria-hidden="true" />
          <span>{option}</span>
        </button>)}
      </div>
    </section>
    <section className={styles.section} aria-labelledby={advancedLabelId}>
      <div className={styles.preferenceRow}>
        <div className={styles.preferenceCopy}>
          <h3 id={advancedLabelId}>Advanced editing</h3>
          <p id={advancedHelpId}>Show Structure, Style and Logic alongside the visual tools.</p>
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
      {storageSaveFailed && <p className={styles.preferenceNote} role="status">
        Couldn’t save this setting. It still applies to this session.
      </p>}
    </section>
    <section className={styles.section}>
      <div className={styles.preferenceRow}>
        <div className={styles.preferenceCopy}><h3 id="reduce-motion-heading">Reduce motion</h3><p>Use cuts when opening panels and switching scenes.</p></div>
        <button className={styles.preferenceSwitch} type="button" role="switch" aria-checked={reduceMotion}
          aria-labelledby="reduce-motion-heading" onClick={() => setReduceMotion(!reduceMotion)}>
          <span className={styles.switchTrack} aria-hidden="true"><span className={styles.switchThumb} /></span>
        </button>
      </div>
    </section>
    {screen === "editor" && <section className={styles.section} aria-labelledby="more-export-heading">
      <h3 id="more-export-heading">Export</h3>
      <div className={styles.actions}>
        <button type="button" onClick={() => requestExport("video")}>Flat video</button>
        <button type="button" onClick={() => requestExport("pvo")}>Interactive (.pvo)</button>
      </div>
      <p className={styles.exportNote}>Interactive (.pvo) carries components · flat video does not.</p>
    </section>}
    {advancedEditingEnabled && <AdvancedSettings />}
    <ProjectStorageStatus onlyIssues />
    <CaptureRecovery />
  </div>;
}
