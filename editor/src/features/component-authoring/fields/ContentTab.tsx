import { useMemo, useState } from "react";
import { choiceOptions, fieldsShownFor } from "../../../domain/components/fields";
import type { ComponentFields, Outcome, PvoComponent, Scene } from "../../../domain/project/model";
import { useCapture } from "../../../state/captureStore";
import { FieldInput } from "./FieldInput";
import { FormContent } from "./FormContent";
import styles from "../NoCodeEditor.module.css";

const isRequest = (outcome: Outcome | undefined) => outcome?.kind === "request";

function responseSources(scenes: readonly Scene[]) {
  return scenes.flatMap((scene) => scene.components.flatMap((item) => {
    if (item.type === "tooltip") return [];
    const fields = fieldsShownFor(item);
    const requests = fields.buttons?.some((button) => isRequest(button.outcome))
      || fields.options?.some((option) => isRequest(option.outcome))
      || isRequest(fields.outcome)
      || (item.type === "form" && fields.formSubmitMode === "request");
    if (!requests) return [];
    const label = fields.title || fields.prompt || fields.heading || fields.submitLabel
      || (item.type === "form" ? "Form" : item.type === "choice" ? "Choice" : "Message");
    return [{ id: item.id, label, scene: scene.name }];
  }));
}

export function ContentTab({ component, disabled }: { component: PvoComponent; disabled: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const scenes = useCapture(state => state.scenes);
  const requestComponents = useMemo(() => responseSources(scenes), [scenes]);
  const fields = fieldsShownFor(component);
  const change = (patch: Partial<ComponentFields>, undoable = true) => {
    const state = useCapture.getState();
    const current = state.components.find(item => item.id === component.id);
    if (!current || disabled) return;
    try {
      state.updateComponent(component.id, { fields: { ...fieldsShownFor(current), ...patch } }, undoable);
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Couldn't update this component.");
    }
  };
  return <fieldset className={styles.content} disabled={disabled} data-locked={disabled}>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {component.type === "tooltip" && <>
      <FieldInput label="Text" value={fields.text ?? ""}
        maxLength={240} onChange={(text, undoable) => change({ text }, undoable)} />
      {requestComponents.length ? <>
        <p className={styles.hint}>Insert a request result, then replace <code>field</code> with the response field to show.</p>
        {requestComponents.map(source => {
          const token = `{state.responses.${source.id}.field}`;
          return <button key={source.id} className={styles.secondary} type="button"
            onClick={() => change({ text: `${fields.text ?? ""}${fields.text?.trim() ? " " : ""}${token}` })}>
            Insert {source.label} result · {source.scene}
          </button>;
        })}
      </> : <p className={styles.hint}>After another component sends a request, its result can appear here.</p>}
    </>}
    {component.type === "card" && <>
      <FieldInput label="Title" value={fields.title ?? ""} maxLength={30}
        onChange={(title, undoable) => change({ title }, undoable)} />
      <FieldInput label="Text" value={fields.body ?? ""} maxLength={90} multiline
        onChange={(body, undoable) => change({ body }, undoable)} />
      {(fields.buttons ?? []).map((button, index) => <FieldInput key={index}
        label={`Button ${index + 1}`} value={button.label} maxLength={28}
        onChange={(label, undoable) => change({ buttons: fields.buttons?.map((item, at) =>
          at === index ? { ...item, label } : item) }, undoable)} />)}
      {(fields.buttons?.length ?? 0) < 2 ? <button className={styles.secondary} type="button"
        onClick={() => change({ buttons: [...(fields.buttons ?? []), { label: "Got it", outcome: { kind: "continue" } }] })}>
        ＋ Add {fields.buttons?.length ? "a second button" : "a button"}
      </button> : <button className={styles.secondary} type="button"
        onClick={() => change({ buttons: fields.buttons?.slice(0, 1) })}>Remove button 2</button>}
      <p className={styles.hint}>Up to two buttons.</p>
    </>}
    {component.type === "choice" && <>
      <FieldInput label="Prompt" value={fields.prompt ?? ""} maxLength={40}
        onChange={(prompt, undoable) => change({ prompt }, undoable)} />
      {choiceOptions(fields).map((option, index) => <FieldInput key={index}
        label={`Option ${index + 1}`} value={option.label} maxLength={16}
        onChange={(label, undoable) => change({ options: choiceOptions(fields).map((item, at) =>
          at === index ? { ...item, label } : item) }, undoable)} />)}
      <p className={styles.hint}>A choice always has exactly two options.</p>
    </>}
    {component.type === "form" && <FormContent fields={fields} onChange={change} />}
  </fieldset>;
}
