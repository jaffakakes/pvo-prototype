import { fieldsShownFor } from "../../../domain/components/fields";
import { branchAtEndIssue } from "../../../domain/components/branching";
import { isCodeOwned } from "../../../domain/components/codeOwnership";
import { formSubmissionOutcome, formUsesRequest } from "../../../domain/components/forms";
import type { PvoComponent } from "../../../domain/project/model";
import { useCapture } from "../../../state/captureStore";
import { LocalActionControl } from "./LocalActionControl";
import styles from "../NoCodeEditor.module.css";

export function ActionTab({ component, onOpenAdvanced }: {
  component: PvoComponent;
  onOpenAdvanced: () => void;
}) {
  const fields = fieldsShownFor(component);
  const update = useCapture(state => state.updateOutcome);
  if (component.type === "tooltip") return <p className={styles.hint}>
    A note is display-only — viewers read it, they don’t tap it. Want a tap? Use Show a message instead.
  </p>;
  if (component.type === "form") {
    const advancedAction = formUsesRequest(fields);
    const outcome = advancedAction ? fields.outcome : formSubmissionOutcome({ id: component.id, fields });
    return <div className={styles.section}>
      <LocalActionControl key={String(advancedAction)} component={component}
        label={`When viewers tap “${fields.submitLabel || "Continue"}”`} outcome={outcome}
        target={{ kind: "form" }} advancedAction={advancedAction} onOpenAdvanced={onOpenAdvanced}
        onChange={(value, undoable) => update(component.id, { kind: "form" }, value, undoable)} />
      {!advancedAction && <p className={styles.hint}>Answers stay in this video. Choose what plays next.</p>}
    </div>;
  }
  const controls = component.type === "choice" ? fields.options : fields.buttons;
  const branching = !!component.branchAtEnd;
  const branchIssue = branchAtEndIssue(component);
  return <div className={styles.section}>
    {!controls?.length && <p className={styles.hint}>Add a button under Content to give viewers an action.</p>}
    {controls?.map((control, index) => <LocalActionControl key={`${index}-${control.outcome?.kind === "request"}`}
      component={component} label={`When viewers tap “${control.label}”`} outcome={control.outcome}
      target={{ kind: component.type === "choice" ? "option" : "button", index }}
      advancedAction={control.outcome?.kind === "request"} onOpenAdvanced={onOpenAdvanced}
      onChange={(value, undoable) => update(component.id, { kind: component.type === "choice" ? "option" : "button", index }, value, undoable)} />)}
    {component.type === "choice" && !isCodeOwned(component) && <>
      <h3>Branch at layer end</h3>
      <div className={styles.inlineActions}>
        <button type="button" role="switch" aria-checked={branching} aria-label="Branch at layer end"
          onClick={() => useCapture.getState().updateComponent(component.id, { branchAtEnd: !branching })}>
          {branching ? "On" : "Off"}
        </button>
      </div>
      <p className={styles.hint}>{branching
        ? "The video keeps playing while viewers choose. When this layer ends, the chosen option’s scene opens. If nobody has chosen by then, the video waits there."
        : "Off: each option acts as soon as it is tapped."}</p>
      {branching && branchIssue && <p className={styles.error} role="alert">{branchIssue}</p>}
    </>}
  </div>;
}
