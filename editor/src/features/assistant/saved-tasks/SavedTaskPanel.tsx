import { ManualFollowUps } from "./ManualFollowUps";
import { ConnectionsPanel } from "../../account-connections/ConnectionsPanel";
import { TaskAnswer } from "./TaskAnswer";
import { SavedTaskResult } from "./SavedTaskResult";
import { savedTaskStatus } from "../../../domain/assistant/savedTaskStatus";
import { openSignIn } from "../../../state/auth/authGateStore";
import { useSavedTask } from "./useSavedTask";
import styles from "./SavedTaskPanel.module.css";

export function SavedTaskPanel() {
  const session = useSavedTask();
  const status = session.task ? savedTaskStatus(session.task) : null;
  return (
    <section
      className={styles.panel}
      data-saved-task
      aria-label="Saved cloud task"
      aria-busy={session.busy}
    >
      <div className={styles.heading}>
        <strong>Saved task</strong>
        <span role="status">
          {(session.signedOut ? "Sign in" : status?.label) ??
            (session.error
              ? "Failed"
              : session.pending
                ? "Saving your task"
                : "Loading progress")}
        </span>
      </div>
      {session.task && (
        <p className={styles.request}>{session.task.input.request}</p>
      )}
      {session.error ? (
        <p role="alert">{session.error}</p>
      ) : (
        <p>
          {status?.message ??
            "Recovering the saved request for this account and project."}
        </p>
      )}
      {session.task?.state === "waiting" && session.task.nextRunAt !== null && (
        <p>
          Restyle will try again after{" "}
          <time dateTime={new Date(session.task.nextRunAt).toISOString()}>
            {new Date(session.task.nextRunAt).toLocaleString()}
          </time>
          .
        </p>
      )}
      {status?.question?.connection && session.task && !session.signedOut && (
        <ConnectionsPanel
          key={`${session.task.ownerId}:${session.task.id}:${status.question.id}`}
          taskSetup={{
            task: session.task,
            question: status.question,
            updated: session.retry,
            decline: () => {
              void session.answer(
                status.question!.id,
                "Continue without this connection",
              );
            },
          }}
        />
      )}
      {status?.question && !status.question.connection && (
        <TaskAnswer
          key={`${session.task!.id}:${status.question.id}`}
          question={status.question}
          busy={session.busy || session.signedOut}
          answer={(id, value) => {
            void session.answer(id, value);
          }}
        />
      )}
      {session.task && status?.question?.id.startsWith("repair-help-") && (
        <details className={styles.history}>
          <summary>Build check details</summary>
          <p>
            The rejected plan and the check that failed are private to your
            account. Opening these details does not restart the task.
          </p>
          <a
            href={`/api/assistant/tasks/${session.task.id}/diagnostics`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open private diagnostic
          </a>
        </details>
      )}
      {session.task?.questions.some((question) => question.answer) && (
        <details className={styles.history}>
          <summary>Saved answers</summary>
          <dl>
            {session.task.questions
              .filter((question) => question.answer)
              .map((question) => (
                <div key={question.id}>
                  <dt>{question.prompt}</dt>
                  <dd>{question.answer!.value}</dd>
                </div>
              ))}
          </dl>
        </details>
      )}
      {session.task && !session.signedOut && (
        <ManualFollowUps
          plans={session.task.manualPlans}
          busy={session.busy || session.task.state === "running"}
          resolve={(questionId, stepId, status, note) => {
            void session.resolveManual(questionId, stepId, status, note);
          }}
        />
      )}
      {session.task?.state === "ready" && !session.signedOut && (
        <SavedTaskResult task={session.task} />
      )}
      <div className={styles.actions}>
        {session.signedOut ? (
          <button type="button" onClick={() => openSignIn()}>
            Sign in
          </button>
        ) : (
          <>
            {session.expired && session.pending && (
              <button
                type="button"
                disabled={session.busy}
                onClick={session.clearExpired}
              >
                Clear expired request
              </button>
            )}
            {session.error && !(session.expired && session.pending) && (
              <button
                type="button"
                disabled={session.busy}
                onClick={session.retry}
              >
                Retry
              </button>
            )}
            {status?.canResume && (
              <button
                type="button"
                disabled={session.busy}
                onClick={session.resume}
              >
                Resume
              </button>
            )}
            {status?.canStop && (
              <button
                type="button"
                disabled={session.busy}
                onClick={session.stop}
              >
                Stop task
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}
