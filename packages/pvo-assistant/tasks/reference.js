import { id, object } from "./validation.js";

/** A private locator only. Possessing it never grants access to a server task. */
export function parseTaskReference(value) {
  object(value, ["ownerId", "projectId", "taskId"], "Task reference");
  id(value.ownerId, "Task owner ID");
  id(value.projectId, "Server project ID");
  id(value.taskId, "Task ID");
  return structuredClone(value);
}
