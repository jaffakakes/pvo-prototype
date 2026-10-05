import {
  WORKSPACE_LIMITS as limits,
  parseWorkspaceIdentity,
  serializeWorkspaceIdentity,
} from "./contract.js";
import { assertWorkspaceGrant } from "./grants.js";

function requireWorkspace(condition, code) {
  if (!condition)
    throw Object.assign(new Error(code.replaceAll("_", " ")), { code });
}

export function newWorkspace(identity, now) {
  return {
    identity: parseWorkspaceIdentity(identity),
    closed: now >= identity.deadlineAt,
    generation: 0,
    sourceRevision: 0,
    sessions: 0,
    grant: null,
    revokedThrough: 0,
    active: null,
    lease: null,
    cleanupRequired: false,
    cleanupAttempts: 0,
    nextCleanupAt: null,
    contentExpired: false,
  };
}

export function assertWorkspaceOwner(state, identity) {
  requireWorkspace(
    serializeWorkspaceIdentity(state.identity) ===
      serializeWorkspaceIdentity(identity),
    "workspace_ownership_conflict",
  );
}

export function assertWorkspaceOpen(state, now) {
  requireWorkspace(
    !state.closed && now < state.identity.deadlineAt,
    "workspace_closed",
  );
  requireWorkspace(!state.cleanupRequired, "workspace_cleanup_required");
  requireWorkspace(!state.active, "workspace_busy");
  assertWorkspaceGrant(state, now);
}

export function advanceWorkspaceSource(state, revision, now) {
  assertWorkspaceOpen(state, now);
  requireWorkspace(
    revision === state.sourceRevision + 1 && revision <= limits.operations,
    "workspace_source_conflict",
  );
  return { ...state, sourceRevision: revision };
}

/** The caller journals this transition before a provider or command can start. */
export function beginWorkspaceAction(state, { id, kind, now }) {
  assertWorkspaceOpen(state, now);
  requireWorkspace(state.sourceRevision > 0, "workspace_source_missing");
  requireWorkspace(
    ["start", "command"].includes(kind),
    "workspace_action_invalid",
  );
  if (kind === "start") {
    requireWorkspace(!state.lease, "workspace_cleanup_required");
    requireWorkspace(
      state.sessions < limits.sessions,
      "workspace_session_limit",
    );
  } else {
    requireWorkspace(
      state.lease &&
        now < state.lease.deadlineAt &&
        state.lease.sourceRevision === state.sourceRevision,
      "workspace_restore_required",
    );
  }
  const generation = state.generation + 1;
  const deadlineAt = Math.min(
    now + (kind === "start" ? limits.startupMs : limits.commandMs),
    state.identity.deadlineAt,
    state.grant.expiresAt,
    state.lease?.deadlineAt ?? Infinity,
  );
  return {
    ...state,
    generation,
    sessions: state.sessions + (kind === "start" ? 1 : 0),
    lease:
      kind === "start"
        ? {
            id: `${state.identity.resourceId}-${state.sessions + 1}`,
            resourceId: state.identity.resourceId,
            session: state.sessions + 1,
            sourceRevision: state.sourceRevision,
            startedAt: now,
            deadlineAt: Math.min(
              now + limits.sessionMs,
              state.identity.deadlineAt,
              state.grant.expiresAt,
            ),
            expiresAt: state.identity.deadlineAt,
          }
        : state.lease,
    active: { id, kind, generation, deadlineAt },
  };
}

export function assertWorkspaceAction(state, action, now) {
  assertWorkspaceGrant(state, now);
  requireWorkspace(
    !state.closed &&
      state.active?.id === action.id &&
      state.active.generation === action.generation &&
      now < state.active.deadlineAt &&
      now < state.identity.deadlineAt,
    "workspace_action_stale",
  );
}

export function finishWorkspaceAction(state, action, now) {
  assertWorkspaceAction(state, action, now);
  return { ...state, active: null };
}

export function interruptWorkspace(state, now, close = false) {
  return {
    ...state,
    closed: state.closed || close || now >= state.identity.deadlineAt,
    generation: state.generation + 1,
    active: null,
    cleanupRequired: true,
    cleanupAttempts: 0,
    nextCleanupAt: now,
  };
}

export function settleWorkspaceCleanup(state) {
  return {
    ...state,
    active: null,
    lease: null,
    cleanupRequired: false,
    cleanupAttempts: 0,
    nextCleanupAt: null,
  };
}

export function deferWorkspaceCleanup(state, now) {
  const attempts = state.cleanupAttempts + 1;
  return {
    ...state,
    cleanupRequired: true,
    cleanupAttempts: attempts,
    nextCleanupAt:
      attempts < limits.cleanupAttempts
        ? now + 2000 * 2 ** (attempts - 1)
        : null,
  };
}

export function workspaceWakeup(state, now) {
  const candidates = [
    state.active?.deadlineAt,
    !state.cleanupRequired && state.lease?.deadlineAt,
    !state.closed && state.identity.deadlineAt,
    !state.contentExpired && state.identity.expiresAt,
    state.cleanupRequired && state.nextCleanupAt,
  ].filter((value) => typeof value === "number");
  return candidates.length ? Math.max(now, Math.min(...candidates)) : null;
}
