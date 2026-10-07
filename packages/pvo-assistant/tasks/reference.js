import { id, object } from "./validation.js";

/** A private locator only. Possessing it never grants access to a server task. */
export function parseTaskReference(value) {
  object(value, ["ownerId", "projectId", "taskId"], "Task reference");
  id(value.ownerId, "Task owner ID");
  id(value.projectId, "Server project ID");
  id(value.taskId, "Task ID");
  return structuredClone(value);
}

/** A private project locator; no task is invented for a manual service connection. */
export function parseOwnedProjectLink(value) {
  object(value, ["ownerId", "projectId", "taskId"], "Owned project link");
  id(value.ownerId, "Project owner ID");
  id(value.projectId, "Server project ID");
  if (value.taskId !== null) id(value.taskId, "Task ID");
  return structuredClone(value);
}
