import { useId, useState } from "react";
import type {
  ManualPlan,
  ManualResolution,
} from "../../../../../packages/pvo-assistant/tasks/index.js";
import styles from "./SavedTaskPanel.module.css";

type Resolve = (
  questionId: string,
  stepId: string,
  status: ManualResolution["status"],
  note: string,
) => void;
function ManualStep({
  plan,
  index,
  busy,
  resolve,
}: {
  plan: ManualPlan;
  index: number;
  busy: boolean;
  resolve: Resolve;
}) {
  const step = plan.steps[index];
  const [note, setNote] = useState("");
  const inputId = useId();
  const valid =
    note.trim().length > 0 &&
    new TextEncoder().encode(note.trim()).length <= 1000;
  return (
    <li>
      <p>
        <strong>
          {step.resolution?.status === "completed"
            ? "Marked completed"
            : step.resolution
              ? "Cancelled"
              : "Pending"}
        </strong>{" "}
        · {plan.proposal.steps[index].instruction}
      </p>
      {step.resolution ? (
        <p>{step.resolution.note}</p>
      ) : (
        <div className={styles.answer}>
          <label htmlFor={inputId}>What happened?</label>
          <textarea
            id={inputId}
            rows={2}
            maxLength={1000}
            value={note}
            disabled={busy}
            onChange={(event) => setNote(event.currentTarget.value)}
            placeholder="Record the result or why this step is no longer needed."
          />
          <div className={styles.actions}>
            <button
              type="button"
              disabled={busy || !valid}
              onClick={() =>
                resolve(plan.questionId, step.id, "completed", note.trim())
              }
            >
              Mark completed
            </button>
            <button
              type="button"
              disabled={busy || !valid}
              onClick={() =>
                resolve(plan.questionId, step.id, "cancelled", note.trim())
              }
            >
              Cancel step
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
export function ManualFollowUps({
  plans,
  busy,
  resolve,
}: {
  plans: ManualPlan[];
  busy: boolean;
  resolve: Resolve;
}) {
  if (!plans.length) return null;
  return (
    <section className={styles.manual} aria-label="Manual follow-up">
      <h3>Manual follow-up</h3>
      <p>
        These steps stay pending after the component is ready. Mark a step
        completed only after you have done it or confirmed its result.
        Cancelling does not complete the original action.
      </p>
      {plans.map((plan) => (
        <div key={plan.questionId}>
          <p>
            <strong>Chosen outcome:</strong> {plan.proposal.preparedOutcome}
          </p>
          <details>
            <summary>Original request and agreed information</summary>
            <ManualAlternativeSummary plan={plan} />
          </details>
          <ul className={styles.followUps}>
            {plan.steps.map((step, index) => (
              <ManualStep
                key={step.id}
                plan={plan}
                index={index}
                busy={busy}
                resolve={resolve}
              />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
function ManualAlternativeSummary({ plan }: { plan: ManualPlan }) {
  return (
    <>
      <p>{plan.proposal.originalOutcome}</p>
      <p>{plan.proposal.limitation}</p>
      <p>{plan.proposal.notice}</p>
      <ul>
        {plan.proposal.fields.map((field) => (
          <li key={field.name}>
            {field.label}: {field.purpose}
          </li>
        ))}
      </ul>
    </>
  );
}
