import { useState } from "react";
import type { ServiceDraft } from "../../../../packages/pvo-assistant/services/index.js";
import { TASK_LIMITS } from "../../../../packages/pvo-assistant/tasks/index.js";
import { savedTaskStatus } from "../../domain/assistant/savedTaskStatus";
import { TaskAnswer } from "../assistant/saved-tasks/TaskAnswer";
import { useContainerTask } from "./useContainerTask";
import styles from "./ServicesPanel.module.css";

export function ContainerAssistant({
  draft,
  disabled,
  refresh,
}: {
  draft: ServiceDraft;
  disabled: boolean;
  refresh(): void;
}) {
  const [request, setRequest] = useState("");
  const session = useContainerTask(
    draft.identity.ownerId,
    draft.identity.serviceId,
  );
  const status = session.task ? savedTaskStatus(session.task) : null;
  const valid =
    request.trim().length > 0 &&
    new TextEncoder().encode(request.trim()).length <= TASK_LIMITS.requestBytes;
  return (
    <section className={styles.editor} aria-label="Container AI editing">
      <h4>Ask AI to edit this draft</h4>
      <p>
        AI changes are saved to this same draft. Publishing remains a separate
        action. Save your local edits before starting.
      </p>
      {session.canStart && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (valid && !disabled) session.start(draft, request);
          }}
        >
          <label>
            Changes to this Container
            <textarea
              value={request}
              onChange={(event) => setRequest(event.target.value)}
              disabled={disabled || session.busy}
            />
          </label>
          <button type="submit" disabled={disabled || session.busy || !valid}>
            Continue with AI
          </button>
        </form>
      )}
      {session.pending && (
        <p role="status">Recovering the saved editing request…</p>
      )}
      {status && (
        <>
          <p role="status">
            {status.label} · {session.task!.input.request}
          </p>
          <p>
            {session.task!.state === "ready"
              ? "Changes are saved. Refresh the code to review them; any local edits will be kept for comparison."
              : status.message}
          </p>
        </>
      )}
      {session.error && <p role="alert">{session.error}</p>}
      {status?.question && (
        <TaskAnswer
          key={status.question.id}
          question={status.question}
          busy={session.busy}
          answer={session.answer}
        />
      )}
      <div className={styles.actions}>
        {session.expired && (
          <button
            type="button"
            onClick={session.clearExpired}
            disabled={session.busy}
          >
            Clear expired editing task
          </button>
        )}
        {session.error && (
          <button type="button" onClick={session.retry} disabled={session.busy}>
            Retry editing task
          </button>
        )}
        {status?.canResume && (
          <button
            type="button"
            onClick={session.resume}
            disabled={session.busy}
          >
            Resume editing
          </button>
        )}
        {status?.canStop && (
          <button type="button" onClick={session.stop} disabled={session.busy}>
            Stop editing
          </button>
        )}
        {session.task && (
          <button type="button" onClick={refresh}>
            Refresh saved code
          </button>
        )}
      </div>
    </section>
  );
}
