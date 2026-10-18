import type { TaskRecord } from "../../../../../packages/pvo-assistant/tasks/index.js";
import { useBuildDiagnostic } from "./useBuildDiagnostic";
import styles from "./SavedTaskPanel.module.css";

export function BuildDiagnostic({ task }: { task: TaskRecord }) {
  const view = useBuildDiagnostic(task);
  return (
    <details
      className={styles.history}
      onToggle={(event) => view.setOpen(event.currentTarget.open)}
    >
      <summary>Build check details</summary>
      {view.busy && <p>Opening private build details…</p>}
      {view.error && <p role="alert">{view.error}</p>}
      {view.data?.review && (
        <>
          <p>
            <strong>Independent check</strong> · Source revision{" "}
            {view.data.review.revision}
          </p>
          {view.data.review.caseId !== null &&
            view.data.review.step !== null && (
              <p>
                Case: {view.data.review.caseId} · Step{" "}
                {view.data.review.step + 1}
              </p>
            )}
          <p>{view.data.review.detail}</p>
        </>
      )}
      {view.data &&
        (view.data.repair ? (
          <>
            <p>{view.data.repair.message}</p>
            <p>
              Stage: {view.data.stepId} · Same rejected plan:{" "}
              {view.data.repair.repetitions} attempts
            </p>
            <details>
              <summary>Rejected AI plan</summary>
              <pre className={styles.proposal}>
                {view.data.repair.proposal.text}
              </pre>
              {view.data.repair.proposal.truncated && (
                <p>This preview is shortened.</p>
              )}
            </details>
          </>
        ) : (
          !view.data.review && (
            <p>
              Stage: {view.data.stepId}. No rejected plan is saved for this
              stage.
            </p>
          )
        ))}
    </details>
  );
}
