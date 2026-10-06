import { parseTaskRecord } from "../../../packages/pvo-assistant/tasks/index.js";
import { parseWorkspaceIdentity } from "../../../packages/pvo-assistant/workspaces/index.js";
import { contentDigest } from "../../contentDigest.js";

export const workspaceResourceId = (identity) =>
  contentDigest(
    JSON.stringify([identity.ownerId, identity.projectId, identity.taskId]),
  ).then((hash) => `workspace-${hash}`);

/** Only trusted task data selects the resource. Restarts/source revisions retain it. */
export async function prepareWorkspaceIdentity(value) {
  const task = parseTaskRecord(value);
  const identity = {
    ownerId: task.ownerId,
    projectId: task.input.projectId,
    taskId: task.id,
    deadlineAt: task.deadlineAt,
    expiresAt: task.expiresAt,
  };
  return parseWorkspaceIdentity({
    ...identity,
    resourceId: await workspaceResourceId(identity),
  });
}

export async function verifyWorkspaceIdentity(value) {
  const identity = parseWorkspaceIdentity(value);
  if (identity.resourceId !== (await workspaceResourceId(identity)))
    throw new Error("Workspace identity does not match its owner and task.");
  return identity;
}
