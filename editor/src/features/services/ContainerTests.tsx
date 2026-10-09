import { useEffect, useState } from "react";
import type { TaskRecord } from "../../../../packages/pvo-assistant/tasks/index.js";
import type { DraftTestResults } from "../../../../packages/pvo-assistant/results/index.js";
import { readDraftTests } from "../../infrastructure/assistant/savedTaskTransport";
import { useAuthGate } from "../../state/auth/authGateStore";
import styles from "./ServicesPanel.module.css";

export function ContainerTests({ task }: { task: TaskRecord }) {
  const [report, setReport] = useState<DraftTestResults | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const current = () =>
      !controller.signal.aborted &&
      useAuthGate.getState().user?.id === task.ownerId;
    setError(false);
    setReport(null);
    void readDraftTests(task, controller.signal).then(
      (value) => {
        if (current()) setReport(value);
      },
      () => {
        if (current()) setError(true);
      },
    );
    return () => controller.abort();
  }, [task.id, task.ownerId, task.revision, attempt]);
  if (useAuthGate.getState().user?.id !== task.ownerId) return null;
  return (
    <details>
      <summary>Test results</summary>
      {error ? (
        <p role="alert">
          Couldn’t load the test results.{" "}
          <button type="button" onClick={() => setAttempt((v) => v + 1)}>
            Retry test results
          </button>
        </p>
      ) : !report ? (
        <p role="status">Loading test results…</p>
      ) : (
        <>
          <p>Saved draft revision {report.revision}</p>
          <p>
            Selected tests:{" "}
            {report.generated
              ? report.generated.exitCode === 0
                ? "passed"
                : "failed"
              : "no completed result yet"}
          </p>
          {report.generated && (
            <pre className={styles.testOutput}>
              {[report.generated.stdout, report.generated.stderr]
                .filter(Boolean)
                .join("\n") || `Exit code ${report.generated.exitCode}`}
            </pre>
          )}
          <p>Independent checks: {report.report?.status ?? "not started"}</p>
          {report.report && (
            <ul>
              {report.report.cases.map((result) => (
                <li key={result.id}>
                  {result.id}: {result.status} · {result.completedSteps} steps
                  passed
                  {result.failure && (
                    <p>
                      Step {result.failure.step + 1}: {result.failure.detail}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </details>
  );
}
