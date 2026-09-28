import { useState, type CSSProperties } from "react";
import { lookStyles } from "../../../../packages/pvo-component-runtime/index.js";
import { formFieldControls } from "../../domain/components/forms";
import { componentButtonCount, type LookPart } from "../../domain/components/look";
import type { Outcome, PvoComponent } from "../../domain/project/model";
import { cx } from "../../styles";
import { runFormSubmission } from "./tryMode";
import { useTryFeedback } from "./tryFeedbackStore";
import styles from "./ComponentParts.module.css";

export function ComponentFieldsView({ component, unit, trying, selectedPart, onOutcome }: {
  component: PvoComponent;
  unit: number;
  trying: boolean;
  selectedPart: LookPart | null;
  onOutcome: (component: PvoComponent, outcome: Outcome) => void;
}) {
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const pending = useTryFeedback(state => state.components[component.id]?.phase === "pending");
  const fields = component.fields;
  const appearance = component.look ? lookStyles(component.look, unit, componentButtonCount(component)) : null;
  const part = (name: LookPart, style?: Record<string, string | number>) => ({
    "data-look-part": name,
    "data-part-selected": !trying && selectedPart === name,
    className: styles.part,
    ...(style ? { style: style as CSSProperties } : {}),
  });
  const button = (index: number) => part(`button:${index}`,
    appearance ? { ...appearance.buttons[index], height: "auto" } : undefined);
  const whole = part("whole", appearance?.whole);
  if (component.type === "tooltip") return <div {...whole} className={`${cx("compTooltip")} ${styles.part}`}>
    {!appearance && <i />}
    <span {...part("body", appearance?.body)}>{fields.text || "Tap to learn more"}</span>
  </div>;
  if (component.type === "card") return <div {...whole} className={`${cx("compCard")} ${styles.part}`}>
    <h3 {...part("heading", appearance?.heading)}>{fields.title || "Title"}</h3>
    <p {...part("body", appearance?.body)}>{fields.body || "Text"}</p>
    {!!fields.buttons?.length && <div className={cx("compCardButtons")}>
      {fields.buttons.slice(0, 2).map((item, index) => <button
        {...button(index)}
        key={index}
        type="button"
        disabled={!trying}
        onClick={() => onOutcome(component, item.outcome ?? { kind: "continue" })}
      >{item.label || `Button ${index + 1}`}</button>)}
    </div>}
  </div>;
  if (component.type === "choice") return <div {...whole} className={`${cx("compChoice")} ${styles.part}`}>
    <h3 {...part("heading", appearance?.heading)}>{fields.prompt || "Which one?"}</h3>
    {[0, 1].map(index => <button
      {...button(index)}
      key={index}
      type="button"
      disabled={!trying}
      onClick={() => onOutcome(component, fields.options?.[index]?.outcome ?? { kind: "continue" })}
    >{fields.options?.[index]?.label || `Option ${String.fromCharCode(65 + index)}`}</button>)}
  </div>;
  const controls = formFieldControls(fields);
  const setFieldValue = (name: string, value: string) => setFormValues(previous => ({ ...previous, [name]: value }));
  return <form {...whole} className={`${cx("compForm")} ${styles.part}`} aria-busy={pending} onSubmit={event => {
    event.preventDefault();
    if (!trying || pending) return;
    const values = Object.fromEntries(controls.map(field => [
      field.name, formValues[field.name] ?? (field.type === "yesno" ? "no" : ""),
    ]));
    void runFormSubmission(component, values);
  }}>
    {fields.heading && <h3 {...part("heading", appearance?.heading)}>{fields.heading}</h3>}
    <div {...part("body", appearance?.body)} className={`${styles.fields} ${styles.part}`}>
      {controls.map(field => <label key={field.name} className={styles.field}>
        <span>{field.label}</span>
        {field.type === "yesno" ? <select
          style={appearance?.field as CSSProperties}
          disabled={!trying || pending}
          aria-label={field.label}
          value={formValues[field.name] ?? "no"}
          onChange={event => setFieldValue(field.name, event.target.value)}
        >
          <option value="no">No</option>
          <option value="yes">Yes</option>
        </select> : <input
          style={appearance?.field as CSSProperties}
          disabled={!trying || pending}
          aria-label={field.label}
          placeholder={field.label}
          type={field.inputType}
          step={field.type === "number" ? "any" : undefined}
          value={formValues[field.name] ?? ""}
          onChange={event => setFieldValue(field.name, event.target.value)}
        />}
      </label>)}
    </div>
    <button {...button(0)} type="submit" disabled={!trying || pending}>
      {pending ? fields.waitingLabel || "Sending…" : fields.submitLabel || "Send"}
    </button>
  </form>;
}
