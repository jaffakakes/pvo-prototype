import { fieldsShownFor } from "../../../domain/components/fields";
import { responsePolicyFor } from "../../../domain/components/responsePolicy";
import { formSubmissionOutcome, formUsesRequest } from "../../../domain/components/forms";
import type { PvoComponent, ResponsePolicy } from "../../../domain/project/model";
import { useCapture } from "../../../state/captureStore";
import { ActionRow } from "./ActionRow";
import { FormReplyCollection } from "./FormReplyCollection";
import { LocalActionControl } from "./LocalActionControl";
import styles from "../NoCodeEditor.module.css";

function ResponsePolicyControls({ component, canRespond = true }: {
  component: PvoComponent;
  canRespond?: boolean;
}) {
  const policy = responsePolicyFor(component);
  const update = (changes: Partial<ResponsePolicy>) => useCapture.getState().updateComponent(component.id, {
    responsePolicy: { ...policy, ...changes },
  });
  return <>
    <h3>Run response right away</h3>
    <div className={styles.inlineActions}>
      <button type="button" role="switch" aria-checked={policy.dispatch === "interaction"}
        aria-label="Run response right away"
        onClick={() => update({ dispatch: policy.dispatch === "interaction" ? "layer_end" : "interaction" })}>
        {policy.dispatch === "interaction" ? "On" : "Off"}
      </button>
    </div>
    <p className={styles.hint}>{policy.dispatch === "interaction"
      ? "The selected action runs as soon as the viewer responds."
      : "The answer is saved, then its action runs when this layer ends."}</p>
    <h3>Pause if nobody responds</h3>
    <div className={styles.inlineActions}>
      <button type="button" role="switch" aria-checked={policy.unanswered === "pause"}
        aria-label="Pause if nobody responds"
        disabled={!canRespond && policy.unanswered === "continue"}
        onClick={() => update({ unanswered: policy.unanswered === "pause" ? "continue" : "pause" })}>
        {policy.unanswered === "pause" ? "On" : "Off"}
      </button>
    </div>
    <p className={styles.hint}>{!canRespond
      ? "Add a button before this Message can pause for a response."
      : policy.unanswered === "pause"
      ? "At the layer end, the video waits and keeps this component visible."
      : "At the layer end, the video keeps playing when nobody responds."}</p>
  </>;
}

export function ActionTab({ component, onOpenAdvanced }: {
  component: PvoComponent;
  onOpenAdvanced: () => void;
}) {
  const fields = fieldsShownFor(component);
  const update = useCapture(state => state.updateOutcome);
  if (component.type === "tooltip") return <p className={styles.hint}>
    A note is display-only — viewers read it, they don’t tap it. It can show saved state or a request result in its text.
  </p>;
  if (component.type === "form") {
    const collecting = fields.formSubmitMode === "collect";
    const advancedAction = !collecting && formUsesRequest(fields);
    const outcome = advancedAction ? fields.outcome : formSubmissionOutcome({ id: component.id, fields });
    const changeCollectRoute = (value: typeof fields.successOutcome, undoable = true) => {
      if (!value) return false;
      const state = useCapture.getState();
      const current = state.scenes.flatMap(scene => scene.components).find(item => item.id === component.id);
      if (!current || current.type !== "form") return false;
      const shown = fieldsShownFor(current);
      if (shown.formSubmitMode !== "collect") return false;
      state.updateComponent(component.id, { fields: { ...shown, successOutcome: value } }, undoable);
      return true;
    };
    return <div className={styles.section}>
      <FormReplyCollection component={component} fields={fields} />
      {collecting ? <ActionRow component={component} label="After a reply is sent"
        detail="Choose what plays next" outcome={fields.successOutcome ?? { kind: "continue" }}
        target={{ kind: "form" }} branch="success" onChange={changeCollectRoute} />
        : <LocalActionControl key={String(advancedAction)} component={component}
          label={`When viewers tap “${fields.submitLabel || "Continue"}”`} outcome={outcome}
          target={{ kind: "form" }} advancedAction={advancedAction} onOpenAdvanced={onOpenAdvanced}
          onChange={(value, undoable) => update(component.id, { kind: "form" }, value, undoable)} />}
      {!collecting && !advancedAction && <p className={styles.hint}>Answers stay in this video. Choose what plays next.</p>}
      <ResponsePolicyControls component={component} />
    </div>;
  }
  const controls = component.type === "choice" ? fields.options : fields.buttons;
  return <div className={styles.section}>
    {!controls?.length && <p className={styles.hint}>Add a button under Content to give viewers an action.</p>}
    {controls?.map((control, index) => <LocalActionControl key={`${index}-${control.outcome?.kind === "request"}`}
      component={component} label={`When viewers tap “${control.label}”`} outcome={control.outcome}
      target={{ kind: component.type === "choice" ? "option" : "button", index }}
      advancedAction={control.outcome?.kind === "request"} onOpenAdvanced={onOpenAdvanced}
      onChange={(value, undoable) => update(component.id, { kind: component.type === "choice" ? "option" : "button", index }, value, undoable)} />)}
    <ResponsePolicyControls component={component} canRespond={!!controls?.length} />
  </div>;
}
