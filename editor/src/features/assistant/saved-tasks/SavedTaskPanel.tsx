import { SavedTaskResult } from "./SavedTaskResult";
import { useId, useState } from "react";
import {
  TASK_LIMITS,
  type TaskQuestion,
} from "../../../../../packages/pvo-assistant/tasks/index.js";
import { savedTaskStatus } from "../../../domain/assistant/savedTaskStatus";
import { openSignIn } from "../../../state/auth/authGateStore";
import { useSavedTask } from "./useSavedTask";
import styles from "./SavedTaskPanel.module.css";

function TaskAnswer({
  question,
  busy,
  answer,
}: {
  question: TaskQuestion;
  busy: boolean;
  answer(id: string, value: string): void;
}) {
  const [value, setValue] = useState("");
  const inputId = useId();
  const valid =
    value.trim().length > 0 &&
    new TextEncoder().encode(value.trim()).byteLength <=
      TASK_LIMITS.answerBytes;
  return (
    <form
      className={styles.answer}
      onSubmit={(event) => {
        event.preventDefault();
        if (valid && !busy) answer(question.id, value.trim());
      }}
    >
      <label htmlFor={inputId}>{question.prompt}</label>
      {question.choices.length > 0 && (
        <div className={styles.choices} aria-label="Suggested answers">
          {question.choices.map((choice) => (
            <button
              type="button"
              key={choice}
              disabled={busy}
              aria-pressed={value === choice}
              onClick={() => setValue(choice)}
            >
              {choice}
            </button>
          ))}
        </div>
      )}
      <textarea
        id={inputId}
        value={value}
        maxLength={TASK_LIMITS.answerBytes}
        disabled={busy}
        placeholder="Your answer…"
        rows={3}
        onChange={(event) => setValue(event.currentTarget.value)}
      />
      <button type="submit" disabled={!valid || busy}>
        Save answer
      </button>
    </form>
  );
}

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
      {status?.question && (
        <TaskAnswer
          key={`${session.task!.id}:${status.question.id}`}
          question={status.question}
          busy={session.busy || session.signedOut}
          answer={(id, value) => {
            void session.answer(id, value);
          }}
        />
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
