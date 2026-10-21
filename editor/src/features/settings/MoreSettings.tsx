import { useId, useState } from "react";
import type { Ratio } from "../../domain/project/model";
import { RATIOS } from "../../domain/project/ratio";
import { resetComponentLook } from "../../domain/components/look";
import { isVisualEditingBlocked } from "../../domain/components/codeOwnership";
import { editComponentLook } from "../../domain/components/languageLook";
import { useCapture } from "../../state/captureStore";
import { useEditorPreferences } from "../../state/preferences/editorPreferences";
import { SceneSettings } from "../scenes/SceneSettings";
import { AppearanceSettings, AdvancedEditingSetting, ReduceMotionSetting } from "./EditorPreferencesSettings";
import { AdvancedSettings } from "./AdvancedSettings";
import { ProjectStorageStatus } from "./ProjectStorageStatus";
import { CaptureRecovery } from "../capture/CaptureRecovery";
import { ReplyInbox } from "../replies/ReplyInbox";
import styles from "./MoreSettings.module.css";
import { openSignIn, useAuthGate } from "../../state/auth/authGateStore";

const ratios = Object.keys(RATIOS) as Ratio[];
export function MoreSettings() {
  const user = useAuthGate(state => state.user);
  const ratio = useCapture(state => state.ratio);
  const edit = useCapture(state => state.edit);
  const advancedEditingEnabled = useEditorPreferences(state => state.advancedEditingEnabled);
  const currentSceneId = useCapture(state => state.currentSceneId);
  const screen = useCapture(state => state.screen);
  const component = useCapture(state => state.components.find(item => item.id === state.selComp));
  const [appearanceError, setAppearanceError] = useState<string | null>(null);
  const [showReplies, setShowReplies] = useState(false);
  const repliesId = useId();

  return <div className={styles.content}>
    {user && <section className={styles.section} aria-label="Account">
      <h3>Account</h3>
      <div className={styles.actions}>
        <button type="button" onClick={() => openSignIn()}>Your account</button>
      </div>
    </section>}
    <AppearanceSettings />
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
    <AdvancedEditingSetting />
    <ReduceMotionSetting />
    {user && <section className={styles.section} aria-label="Replies">
      <h3>Replies</h3>
      <div className={styles.actions}>
        <button type="button" aria-expanded={showReplies} aria-controls={repliesId}
          onClick={() => setShowReplies(!showReplies)}>{showReplies ? "Close replies" : "Open replies"}</button>
      </div>
      {showReplies && <div id={repliesId}><ReplyInbox /></div>}
    </section>}
    {advancedEditingEnabled && <AdvancedSettings />}
    <ProjectStorageStatus onlyIssues />
    <CaptureRecovery />
  </div>;
}
