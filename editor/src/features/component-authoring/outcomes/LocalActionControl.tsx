import { useState } from "react";
import type { Outcome, OutcomeTarget, PlaybackOutcome, PvoComponent } from "../../../domain/project/model";
import { ActionRow } from "./ActionRow";
import styles from "../NoCodeEditor.module.css";

/** Existing Advanced actions are preserved until a simple replacement is explicitly chosen. */
export function LocalActionControl({ component, label, outcome, target, advancedAction, onChange, onOpenAdvanced }: {
  component: PvoComponent;
  label: string;
  outcome: Outcome | null | undefined;
  target: OutcomeTarget;
  advancedAction: boolean;
  onChange: (value: PlaybackOutcome, undoable?: boolean) => boolean | void;
  onOpenAdvanced: () => void;
}) {
  const [replacing, setReplacing] = useState(false);
  if (!advancedAction) return <ActionRow component={component} label={label}
    outcome={outcome?.kind === "request" ? { kind: "continue" } : outcome ?? { kind: "continue" }}
    target={target} onChange={onChange} />;
  return <div className={styles.section}>
    <h3>{label}</h3>
    <div className={styles.banner}>
      <strong>Advanced action</strong>
      <p>Edit this action in Advanced → Logic using PVO code. Content and Look stay editable.</p>
      <div className={styles.inlineActions}>
        <button type="button" onClick={onOpenAdvanced}>Open Advanced</button>
        <button type="button" onClick={() => setReplacing(!replacing)}>
          {replacing ? "Keep Advanced action" : "Replace with simple action…"}
        </button>
      </div>
    </div>
    {replacing && <>
      <p className={styles.hint}>Choosing a simple action replaces this Advanced action.</p>
      <ActionRow component={component} label="Choose the replacement" outcome={null}
        target={target} onChange={onChange} initiallyOpen />
    </>}
  </div>;
}
