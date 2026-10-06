import assert from "node:assert/strict";
import test from "node:test";
import {
  newWorkspace,
  advanceWorkspaceSource,
  beginWorkspaceAction,
  finishWorkspaceAction,
  interruptWorkspace,
  assertWorkspaceAction,
  deferWorkspaceCleanup,
  settleWorkspaceCleanup,
  workspaceWakeup,
  WORKSPACE_LIMITS,
  parseWorkspaceRun,
  authorizeWorkspaceExecution,
} from "../../packages/pvo-assistant/workspaces/index.js";
import {
  parseServiceFiles,
  serializeServiceFiles,
} from "../../packages/pvo-assistant/services/index.js";
import { identity, NOW, files, command, executionGrant } from "./helpers.mjs";

test("draft source accepts partial/empty files while rejecting unsafe and overlarge contents", () => {
  assert.deepEqual(parseServiceFiles([]), []);
  assert.deepEqual(parseServiceFiles(files().slice(0, 1)), files().slice(0, 1));
  for (const changed of [
    [{ path: "../key.mjs", content: "x" }],
    [{ path: "src/a.mjs", content: "x", symlink: "/secret" }],
    [{ path: "src/a.mjs", content: "é".repeat(65537) }],
    [...files(), files()[0]],
  ])
    assert.throws(() => parseServiceFiles(changed));
  const reversed = files().map(({ path, content }) => ({ content, path }));
  assert.equal(serializeServiceFiles(files()), serializeServiceFiles(reversed));
});

test("action intent retains a stable, bounded reservation before any provider effect", async () => {
  let state = advanceWorkspaceSource(
    authorizeWorkspaceExecution(
      newWorkspace(await identity()),
      executionGrant(),
      NOW,
    ),
    1,
    NOW,
  );
  state = beginWorkspaceAction(state, {
    id: "start-one",
    kind: "start",
    now: NOW,
  });
  assert.equal(state.lease.id, `${state.identity.resourceId}-1`);
  assert.equal(state.lease.deadlineAt, executionGrant().expiresAt);
  assert.throws(
    () =>
      beginWorkspaceAction(state, { id: "duplicate", kind: "start", now: NOW }),
    /busy/,
  );
  const stopped = interruptWorkspace(state, NOW + 1, true);
  assert.equal(stopped.lease.id, state.lease.id);
  assert.throws(
    () => finishWorkspaceAction(stopped, state.active, NOW + 2),
    /stale/,
  );
  assert.throws(
    () => assertWorkspaceAction(state, state.active, state.active.deadlineAt),
    /stale/,
  );
  const clean = settleWorkspaceCleanup(stopped);
  assert.equal(clean.closed, true);
  assert.equal(clean.sourceRevision, 1);
  assert.throws(() => advanceWorkspaceSource(clean, 2, NOW + 3), /closed/);
});

test("cleanup retries stop without losing the obligation or creating a past-due alarm loop", async () => {
  let state = interruptWorkspace(newWorkspace(await identity()), NOW, true);
  for (let i = 1; i <= WORKSPACE_LIMITS.cleanupAttempts; i++)
    state = deferWorkspaceCleanup(state, NOW);
  assert.equal(state.nextCleanupAt, null);
  assert.equal(state.cleanupRequired, true);
  assert.equal(workspaceWakeup(state, NOW), state.contentExpiresAt);
  assert.equal(
    workspaceWakeup({ ...state, contentExpired: true }, state.contentExpiresAt),
    null,
  );
});

test("commands cannot set environment, invoke a shell, or read arbitrary paths", () => {
  const valid = command({ revision: 1, digest: "a".repeat(64) });
  assert.deepEqual(parseWorkspaceRun(valid, true), valid);
  for (const mutate of [
    (x) => (x.command.kind = "shell"),
    (x) => (x.command.env = { TOKEN: "anything" }),
    (x) => (x.command.paths = ["/etc/passwd"]),
    (x) => (x.command.paths = ["src/service.mjs"]),
    (x) => (x.command.paths = []),
    (x) => (x.argv = ["sh"]),
  ]) {
    const value = structuredClone(valid);
    mutate(value);
    assert.throws(() => parseWorkspaceRun(value, true));
  }
});
