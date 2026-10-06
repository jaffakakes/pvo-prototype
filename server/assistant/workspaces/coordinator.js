import { DurableObject } from "cloudflare:workers";
import {
  WORKSPACE_LIMITS as limits,
  newWorkspace,
  assertWorkspaceOwner,
  advanceWorkspaceSource,
  beginWorkspaceAction,
  assertWorkspaceAction,
  finishWorkspaceAction,
  interruptWorkspace,
  settleWorkspaceCleanup,
  deferWorkspaceCleanup,
  workspaceWakeup,
  parseWorkspaceSave,
  parseWorkspaceRun,
  parseWorkspaceGrant,
  authorizeWorkspaceExecution,
  revokeWorkspaceGrant,
  parseWorkspaceOperationId,
  serializeWorkspaceRequest,
} from "../../../packages/pvo-assistant/workspaces/index.js";
import { serializeServiceFiles } from "../../../packages/pvo-assistant/services/index.js";
import { TASK_LIMITS } from "../../../packages/pvo-assistant/tasks/index.js";
import { contentDigest } from "../../contentDigest.js";
import { withAssistantDeadline } from "../deadline.js";
import { verifyWorkspaceIdentity } from "./identity.js";
import { WorkspaceContainer } from "./container.js";
import { WorkspaceJournal } from "./journal.js";

const fail = (code) => {
  throw Object.assign(new Error(code.replaceAll("_", " ")), { code });
};
const snapshotReference = (source) => ({
  revision: source.revision,
  digest: source.digest,
});

/** Private binding only; the saved-task adapter must supply ownership and a current execution claim. */
export class AssistantWorkspace extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.journal = new WorkspaceJournal(ctx.storage.sql);
    this.cleanupFlight = null;
    ctx.blockConcurrencyWhile(async () => {
      const state = this.journal.state();
      // An interrupted process is never replayed: discard the VM, then restore saved files on a new request.
      if (state && (state.active || state.lease) && !state.cleanupRequired)
        this.interrupt(false);
      await this.schedule();
    });
  }
  now() {
    return Date.now();
  }
  provider() {
    return new WorkspaceContainer(this.ctx.container);
  }
  budget() {
    return this.env.WORKSPACE_BUDGET?.getByName("global");
  }
  effectTimeoutMs() {
    return 5000;
  }
  transaction(operation) {
    return this.ctx.storage.transactionSync(operation);
  }

  async owned(value) {
    const identity = await verifyWorkspaceIdentity(value);
    this.transaction(() => {
      const current = this.journal.state();
      if (current) assertWorkspaceOwner(current, identity);
      else {
        if (identity.deadlineAt > this.now() + TASK_LIMITS.lifetimeMs)
          fail("workspace_deadline_invalid");
        this.journal.saveState(newWorkspace(identity, this.now()));
      }
    });
    await this.maintain();
    return identity;
  }
  async schedule() {
    const state = this.journal.state();
    const next = state && workspaceWakeup(state, this.now());
    if (next !== null) await this.ctx.storage.setAlarm(next);
    else await this.ctx.storage.deleteAlarm();
  }
  observation() {
    const state = this.journal.state();
    return {
      identity: state.identity,
      closed: state.closed,
      cleanupRequired: state.cleanupRequired,
      cleanupAttempts: state.cleanupAttempts,
      active: state.active,
      grant: state.grant,
      revokedThrough: state.revokedThrough,
      lease: state.lease,
      source: state.contentExpired ? null : this.journal.source(),
    };
  }
  async lookup(value) {
    await this.owned(value);
    return this.observation();
  }
  async receipt(value, operationId) {
    const id = parseWorkspaceOperationId(operationId);
    await this.owned(value);
    return this.journal.state().contentExpired ? null : this.journal.action(id);
  }

  prior(id, digest) {
    const state = this.journal.state();
    if (state.contentExpired) fail("workspace_content_expired");
    const prior = this.journal.action(id);
    if (prior) {
      if (prior.digest !== digest) fail("workspace_operation_conflict");
      return prior;
    }
    if (this.journal.actionCount() >= limits.operations)
      fail("workspace_operation_limit");
    return null;
  }
  async save(value, input, execution) {
    const request = parseWorkspaceSave(input);
    const grant = parseWorkspaceGrant(execution);
    const digest = await contentDigest(
      serializeWorkspaceRequest("save", request),
    );
    const sourceDigest = await contentDigest(
      serializeServiceFiles(request.files),
    );
    await this.owned(value);
    const receipt = this.transaction(() => {
      const prior = this.prior(request.id, digest);
      if (prior) return prior;
      let state = authorizeWorkspaceExecution(
        this.journal.state(),
        grant,
        this.now(),
      );
      if (request.expectedRevision !== state.sourceRevision)
        fail("workspace_source_conflict");
      const source = {
        revision: state.sourceRevision + 1,
        digest: sourceDigest,
        files: request.files,
      };
      state = advanceWorkspaceSource(state, source.revision, this.now());
      if (state.lease) state = interruptWorkspace(state, this.now());
      const result = {
        id: request.id,
        kind: "save",
        digest,
        status: "completed",
        result: snapshotReference(source),
      };
      this.journal.saveState(state);
      this.journal.saveSource(source);
      this.journal.saveAction(result);
      return result;
    });
    await this.schedule();
    await this.cleanup();
    return receipt;
  }
  async start(value, input, execution) {
    return this.run(value, input, "start", execution);
  }
  async execute(value, input, execution) {
    return this.run(value, input, "command", execution);
  }

  async run(value, input, kind, execution) {
    const request = parseWorkspaceRun(input, kind === "command");
    const grant = parseWorkspaceGrant(execution);
    const digest = await contentDigest(
      serializeWorkspaceRequest(kind, request),
    );
    await this.owned(value);
    const intent = this.transaction(() => {
      const prior = this.prior(request.id, digest);
      if (prior) return { prior };
      const source = this.journal.source();
      if (
        !source ||
        source.revision !== request.revision ||
        source.digest !== request.digest
      )
        fail("workspace_source_conflict");
      if (
        request.command?.paths.some(
          (path) => !source.files.some((file) => file.path === path),
        )
      )
        fail("workspace_file_missing");
      const state = beginWorkspaceAction(
        authorizeWorkspaceExecution(this.journal.state(), grant, this.now()),
        {
          id: request.id,
          kind,
          now: this.now(),
        },
      );
      const receipt = {
        id: request.id,
        kind,
        digest,
        status: "pending",
        result: null,
      };
      this.journal.saveState(state);
      this.journal.saveAction(receipt);
      return { action: state.active, lease: state.lease, source };
    });
    if (intent.prior) return intent.prior;
    await this.schedule();
    try {
      const result = await withAssistantDeadline(
        async () => {
          this.current(intent.action);
          const provider = this.provider();
          if (kind === "start") {
            const budget = this.budget();
            if (!budget) fail("workspace_provider_unavailable");
            if (!(await budget.reserve(intent.lease)))
              fail("workspace_budget_exhausted");
            this.current(intent.action);
            if (!(await provider.absent())) fail("workspace_cleanup_required");
            this.current(intent.action);
            // Native start is synchronous. No await may separate the guard from dispatch.
            provider.start(intent.lease);
            await provider.restore(intent.source, () =>
              this.current(intent.action),
            );
            this.current(intent.action);
            return {
              ...snapshotReference(intent.source),
              deadlineAt: intent.lease.deadlineAt,
            };
          }
          const result = await provider.execute(request.command);
          this.current(intent.action);
          return result;
        },
        Math.max(1, intent.action.deadlineAt - this.now()),
      );
      this.transaction(() => {
        let state = finishWorkspaceAction(
          this.journal.state(),
          intent.action,
          this.now(),
        );
        if (kind === "command" && result.exitCode !== 0)
          state = interruptWorkspace(state, this.now());
        this.journal.saveState(state);
        this.journal.saveAction({
          ...this.journal.action(request.id),
          status: "completed",
          result,
        });
      });
    } catch (error) {
      this.transaction(() => {
        const state = this.journal.state();
        if (state.active?.generation !== intent.action.generation) return;
        const code = [
          "workspace_budget_exhausted",
          "workspace_provider_unavailable",
          "workspace_output_limit",
        ].includes(error.code)
          ? error.code
          : "workspace_execution_interrupted";
        this.interrupt(false, code);
      });
    }
    await this.schedule();
    await this.cleanup();
    return this.journal.action(request.id);
  }
  current(action) {
    assertWorkspaceAction(this.journal.state(), action, this.now());
  }
  interrupt(close, code = "workspace_execution_interrupted") {
    const state = this.journal.state();
    if (state.active) {
      const receipt = this.journal.action(state.active.id);
      if (receipt)
        this.journal.saveAction({
          ...receipt,
          status: "interrupted",
          result: { code },
        });
    }
    this.journal.saveState(interruptWorkspace(state, this.now(), close));
  }
  async stop(value) {
    await this.owned(value);
    this.transaction(() => {
      if (!this.journal.state().closed)
        this.interrupt(true, "workspace_stopped");
    });
    await this.schedule();
    await this.cleanup();
    return this.observation();
  }
  async suspend(value, generation) {
    await this.owned(value);
    this.transaction(() => {
      const state = revokeWorkspaceGrant(this.journal.state(), generation);
      this.journal.saveState(state);
      if (
        state.grant &&
        state.grant.generation <= state.revokedThrough &&
        !state.cleanupRequired &&
        (state.active || state.lease)
      )
        this.interrupt(false, "workspace_claim_revoked");
    });
    await this.schedule();
    await this.cleanup();
    return this.observation();
  }
  /** Explicit operator recovery after the automatic retry batch is exhausted. */
  async reconcile(value) {
    await this.owned(value);
    this.transaction(() => {
      const state = this.journal.state();
      if (state.cleanupRequired && state.nextCleanupAt === null) {
        this.journal.saveState({
          ...state,
          cleanupAttempts: 0,
          nextCleanupAt: this.now(),
        });
      }
    });
    await this.schedule();
    await this.cleanup();
    return this.observation();
  }
  async maintain() {
    this.transaction(() => {
      const state = this.journal.state();
      if (!state) return;
      const now = this.now();
      if (
        (!state.closed && now >= state.identity.deadlineAt) ||
        (state.active && now >= state.active.deadlineAt) ||
        (!state.cleanupRequired && state.lease && now >= state.lease.deadlineAt)
      )
        this.interrupt(now >= state.identity.deadlineAt);
      const current = this.journal.state();
      if (!current.contentExpired && now >= current.identity.expiresAt) {
        this.journal.expireContent();
        this.journal.saveState({ ...current, contentExpired: true });
      }
    });
    await this.schedule();
    await this.cleanup();
  }
  async cleanup() {
    if (this.cleanupFlight) return this.cleanupFlight;
    const state = this.journal.state();
    if (
      !state?.cleanupRequired ||
      state.nextCleanupAt === null ||
      state.nextCleanupAt > this.now()
    )
      return;
    this.cleanupFlight = this.clean(state);
    try {
      await this.cleanupFlight;
    } finally {
      this.cleanupFlight = null;
    }
  }
  async clean(state) {
    try {
      const provider = this.provider();
      await withAssistantDeadline(async () => {
        await provider.destroy();
        if (!(await provider.absent())) fail("workspace_cleanup_unconfirmed");
        if (state.lease) {
          const budget = this.budget();
          if (!budget || !(await budget.release(state.lease)))
            fail("workspace_budget_release_unconfirmed");
        }
      }, this.effectTimeoutMs());
      this.transaction(() => {
        const current = this.journal.state();
        if (current.generation === state.generation)
          this.journal.saveState(settleWorkspaceCleanup(current));
      });
    } catch {
      this.transaction(() => {
        const current = this.journal.state();
        if (current.generation === state.generation)
          this.journal.saveState(deferWorkspaceCleanup(current, this.now()));
      });
    }
    await this.schedule();
  }
  async alarm() {
    await this.maintain();
  }
}
