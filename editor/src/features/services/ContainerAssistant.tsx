import { BuildDiagnostic } from "../assistant/saved-tasks/BuildDiagnostic";
import { ContainerRepair } from "./ContainerRepair";
import { ContainerTests } from "./ContainerTests";
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
            if (valid && !disabled) session.start(draft, request, "edit");
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
          <button
            type="button"
            disabled={
              disabled ||
              session.busy ||
              !valid ||
              !draft.content.agreement ||
              !draft.content.tests.length
            }
            onClick={() => session.start(draft, request, "repair")}
          >
            Investigate and repair
          </button>
          <p>
            Describe what went wrong. Restyle checks the saved code with test
            data before making a repair. Account problems receive a recovery
            step.
          </p>
        </form>
      )}
      {session.canStart && (
        <div>
          <h4>Test saved draft</h4>
          <p>
            Run your selected tests and Restyle’s independent checks on revision{" "}
            {draft.revision}. Testing uses cloud resources and leaves the
            published version unchanged.
          </p>
          <button
            type="button"
            disabled={
              disabled ||
              session.busy ||
              !draft.content.agreement ||
              !draft.content.tests.length
            }
            onClick={() =>
              session.start(
                draft,
                `Test saved draft revision ${draft.revision}`,
                "test",
              )
            }
          >
            Test saved draft
          </button>
          {(!draft.content.agreement || !draft.content.tests.length) && (
            <p>Save a behavior agreement and select test files first.</p>
          )}
        </div>
      )}
      {session.pending && <p role="status">Recovering the saved task…</p>}
      {status && (
        <>
          <p role="status">
            {status.label} · {session.task!.input.request}
          </p>
          <p>
            {session.task!.state === "ready" &&
            "container" in session.task!.input.context &&
            session.task!.input.context.container.mode === "test"
              ? `Draft revision ${session.task!.input.context.container.revision} passed its checks. Refresh Containers to review the checked version before publishing.`
              : session.task!.state === "ready"
                ? "Changes are saved. Refresh the code to review them; any local edits will be kept for comparison."
                : status.message}
          </p>
        </>
      )}
      {session.task &&
        "container" in session.task.input.context &&
        session.task.input.context.container.mode === "repair" && (
          <ContainerRepair task={session.task} />
        )}
      {session.task && (
        <>
          <ContainerTests key={session.task.id} task={session.task} />
          <BuildDiagnostic task={session.task} />
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
            Clear expired task
          </button>
        )}
        {session.error && (
          <button type="button" onClick={session.retry} disabled={session.busy}>
            Retry saved task
          </button>
        )}
        {status?.canResume && (
          <button
            type="button"
            onClick={session.resume}
            disabled={session.busy}
          >
            Resume task
          </button>
        )}
        {status?.canStop && (
          <button type="button" onClick={session.stop} disabled={session.busy}>
            Stop task
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
