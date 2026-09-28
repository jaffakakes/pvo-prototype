import { getFormFields, toVisualFormFields } from "../../../domain/components/forms";
import type { ComponentFields, FormField } from "../../../domain/project/model";
import { FieldInput } from "./FieldInput";
import styles from "../NoCodeEditor.module.css";

export function FormContent({ fields, onChange: commit }: {
  fields: ComponentFields;
  onChange: (patch: Partial<ComponentFields>, undoable?: boolean) => void;
}) {
  const onChange = (patch: Partial<ComponentFields>, undoable = true) => commit({ ...toVisualFormFields(fields), ...patch }, undoable);
  const formFields = getFormFields(fields);
  const editField = (index: number, patch: Partial<FormField>, undoable = true) => {
    onChange({ formFields: formFields.map((field, at) => at === index ? { ...field, ...patch } : field) }, undoable);
  };
  return <>
    <FieldInput label="Heading" value={fields.heading ?? ""} maxLength={40}
      onChange={(heading, undoable) => onChange({ heading }, undoable)} />
    <FieldInput label="Submit button" value={fields.submitLabel ?? "Send"} maxLength={28}
      onChange={(submitLabel, undoable) => onChange({ submitLabel }, undoable)} />
    <section className={styles.section}>
      <h3>Fields viewers fill in <span>{formFields.length} / 5</span></h3>
      {formFields.map((field, index) => <div className={styles.formField} key={index}>
        <div className={styles.fieldHead}>
          <FieldInput label={`Field ${index + 1} name`} value={field.name} maxLength={24}
            onChange={(name, undoable) => editField(index, { name }, undoable)} />
          <button type="button" aria-label={`Remove field ${index + 1}`} disabled={formFields.length === 1}
            onClick={() => onChange({ formFields: formFields.filter((_, at) => at !== index) })}>✕</button>
        </div>
        <p>They answer with</p>
        <div className={styles.chips} aria-label={`Field ${index + 1} answer type`}>
          {([['text', 'Text'], ['number', 'A number'], ['yesno', 'Yes / no']] as const).map(([type, label]) =>
            <button key={type} type="button" aria-pressed={field.type === type}
              onClick={() => { if (field.type !== type) editField(index, { type }); }}>{label}</button>)}
        </div>
      </div>)}
      {formFields.length < 5 && <button className={styles.secondary} type="button"
        onClick={() => onChange({ formFields: [...formFields, { name: `Field ${formFields.length + 1}`, type: "text" }] })}>＋ Add a field</button>}
    </section>
  </>;
}
