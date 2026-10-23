/** Decide which task claim must be fenced off before a workspace can be used again. */
export function workspaceTaskCleanup(task, grant, now) {
  if (!task || ["stopped", "ready"].includes(task.state)) return "stop";
  if (
    task.state !== "running" ||
    task.generation !== grant.generation ||
    task.claim.id !== grant.id ||
    grant.expiresAt <= now
  )
    return "suspend";
  return null;
}
