import type { ManualAlternative as Proposal } from "../../../../../packages/pvo-assistant/tasks/index.js";
import styles from "./SavedTaskPanel.module.css";

export function ManualAlternative({ proposal }: { proposal: Proposal }) {
  return (
    <section className={styles.manual} aria-label="Proposed alternative">
      <h3>What will change</h3>
      <dl>
        <dt>Your requested outcome</dt>
        <dd>{proposal.originalOutcome}</dd>
        <dt>What Restyle can prepare</dt>
        <dd>{proposal.preparedOutcome}</dd>
        <dt>Why a person is needed</dt>
        <dd>{proposal.limitation}</dd>
      </dl>
      <p>{proposal.notice}</p>
      {proposal.fields.length > 0 && (
        <>
          <h4>Information to collect</h4>
          <ul>
            {proposal.fields.map((field) => (
              <li key={field.name}>
                <strong>{field.label}:</strong> {field.purpose}
              </li>
            ))}
          </ul>
        </>
      )}
      <h4>Still needs a person</h4>
      <ul>
        {proposal.steps.map((step) => (
          <li key={step.id}>{step.instruction}</li>
        ))}
      </ul>
      <p>
        Your choice is saved before the component changes. Only “Use this
        alternative” accepts this plan; another answer asks the AI to
        reconsider.
      </p>
    </section>
  );
}
