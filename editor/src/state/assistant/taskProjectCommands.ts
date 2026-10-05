import { parseTaskRecord } from "../../../../packages/pvo-assistant/tasks/index.js";
import {
  linkProjectTask,
  ownedTaskReference,
  type TaskProjectLinks,
} from "../../domain/assistant/taskProjectLink";
import { useAuthGate } from "../auth/authGateStore";
import { useCapture } from "../captureStore";
import { useAssistantScope } from "./sessionScope";

type TaskLinkRequest = {
  localId: string;
  ownerId: string;
  epoch: number;
  links: TaskProjectLinks | null;
};

export function currentTaskReference() {
  const project = useCapture.getState();
  const account = useAuthGate.getState();
  return ownedTaskReference(
    project.assistantTaskLinks,
    project.localId,
    account.user?.id ?? null,
  );
}

/** Capture before an authenticated task request. No local ID is a server authorization token. */
export function beginTaskLinkRequest(): TaskLinkRequest {
  const scope = useAssistantScope.getState();
  if (
    !scope.localId ||
    !scope.ownerId ||
    useAuthGate.getState().phase !== "ready"
  )
    throw new Error(
      "Open a saved local project and sign in before linking a task.",
    );
  return {
    ...scope,
    localId: scope.localId,
    ownerId: scope.ownerId,
    links: useCapture.getState().assistantTaskLinks,
  };
}

/** Consume a validated response from the future owned task API; store its IDs only. */
export function linkSavedTask(request: TaskLinkRequest, value: unknown): void {
  const scope = useAssistantScope.getState();
  const project = useCapture.getState();
  if (
    request.epoch !== scope.epoch ||
    request.localId !== scope.localId ||
    request.ownerId !== scope.ownerId ||
    request.links !== project.assistantTaskLinks ||
    useAuthGate.getState().phase !== "ready"
  )
    throw new Error(
      "The project or account changed before this task could be linked.",
    );
  const task = parseTaskRecord(value);
  if (task.ownerId !== request.ownerId)
    throw new Error("The task belongs to a different account.");
  const assistantTaskLinks = linkProjectTask(
    project.assistantTaskLinks,
    request.localId,
    {
      ownerId: task.ownerId,
      projectId: task.input.projectId,
      taskId: task.id,
    },
  );
  project.patch({ assistantTaskLinks });
}
