import { TASK_LIMITS } from "../tasks/limits.js";
import { id, integer, object, requireTask, time } from "../tasks/validation.js";

/** Issued only by a trusted saved-task runner; never accepted from generated code. */
export function parseWorkspaceGrant(value) {
  object(value, ["id", "generation", "expiresAt"], "Workspace execution grant");
  id(value.id, "Task claim ID");
  integer(value.generation, Number.MAX_SAFE_INTEGER, "Task generation", 1);
  time(value.expiresAt, "Task claim expiry");
  return structuredClone(value);
}

export function authorizeWorkspaceExecution(state, value, now) {
  const grant = parseWorkspaceGrant(value);
  requireTask(!state.closed, "Workspace is closed.");
  requireTask(
    grant.expiresAt > now && grant.expiresAt - now <= TASK_LIMITS.leaseMs,
    "Workspace execution grant expired or exceeds its lifetime.",
  );
  requireTask(
    grant.generation > state.revokedThrough &&
      grant.generation >= (state.grant?.generation ?? 0),
    "Workspace execution grant was revoked.",
  );
  if (state.grant?.generation === grant.generation) {
    requireTask(
      state.grant.id === grant.id && state.grant.expiresAt === grant.expiresAt,
      "Workspace execution grant conflicts with its original claim.",
    );
  } else {
    requireTask(
      !state.active && !state.cleanupRequired,
      "Workspace needs reconciliation before a new claim.",
    );
  }
  return { ...state, grant };
}

export function assertWorkspaceGrant(state, now) {
  requireTask(
    state.grant &&
      state.grant.generation > state.revokedThrough &&
      now < state.grant.expiresAt,
    "Workspace execution grant is not current.",
  );
}

export function revokeWorkspaceGrant(state, generation) {
  integer(generation, Number.MAX_SAFE_INTEGER, "Revoked task generation", 1);
  return {
    ...state,
    revokedThrough: Math.max(state.revokedThrough, generation),
  };
}
