import { hasCurrentClaim } from "../assistant/tasks/executionClaim.js";
import {
  protectCredential,
  openCredential,
} from "../connections/credentials.js";
import { HttpError } from "../http.js";
import { VerificationStore } from "./verificationStore.js";
import { verificationPlan, matchVerification } from "./verificationRules.js";
import { verificationMessages } from "./messages.js";

const terminal = ["consumed", "cancelled", "expired"];
const conflict = () =>
  new HttpError(409, "Account verification changed. Resume its saved task.");
const summary = (row) => ({
  taskId: row.taskId,
  service: row.plan.service,
  operationId: row.plan.operationId,
  status: row.status,
  expiresAt: row.plan.expiresAt,
  dispatched: row.dispatched,
});

/** Trusted setup runners only: persistent proof and dispatch fences, never a public inbox/model tool. */
export class AccountVerification {
  constructor(coordinator) {
    this.coordinator = coordinator;
    this.store = new VerificationStore(coordinator.ctx.storage.sql);
    this.active = new Map();
  }
  requireClaim(claimed) {
    this.coordinator.repository.bindOwner(claimed.ownerId);
    const task = this.coordinator.repository.read(
      claimed.id,
      this.coordinator.now(),
    );
    if (!hasCurrentClaim(task, claimed, this.coordinator.now()))
      throw conflict();
    return task;
  }
  requireCurrent(claimed, row) {
    const task = this.requireClaim(claimed);
    const saved = this.store.get(task.id, row.plan.operationId);
    if (
      !saved ||
      saved.revision !== row.revision ||
      saved.ownerId !== task.ownerId ||
      row.stepId !== task.stepId
    )
      throw conflict();
    this.coordinator.accountConnections.expire();
    const identity = this.coordinator.agentIdentity.store.get(
      row.plan.provider,
    )?.channel;
    const account = this.coordinator.accountConnections.same(
      row.connectionId,
      row.connectionRevision,
    );
    if (
      identity?.status !== "ready" ||
      identity.connectionId !== row.connectionId ||
      identity.resourceId !== row.resourceId ||
      identity.address !== row.recipient ||
      account.details.scope.provider !== row.plan.provider ||
      account.details.scope.resourceId !== row.resourceId ||
      account.connection.status !== "connected" ||
      !account.connection.permissions.includes("identity:receive")
    )
      throw conflict();
    if (
      this.coordinator.now() >= row.plan.expiresAt ||
      terminal.includes(row.status)
    )
      throw conflict();
    return account;
  }
  async change(claimed, row, changes, proof = null) {
    const next = { ...row, ...changes, revision: row.revision + 1 };
    delete next.private;
    const encrypted =
      proof === null
        ? null
        : await protectCredential(
            this.coordinator.env,
            row.ownerId,
            `verification:${this.store.key(row.taskId, row.plan.operationId)}`,
            next.revision,
            JSON.stringify(proof),
          );
    this.coordinator.ctx.storage.transactionSync(() => {
      this.requireCurrent(claimed, row);
      this.store.save(next, encrypted, row.revision);
    });
    return this.store.get(row.taskId, row.plan.operationId);
  }
  async privateProof(row) {
    return JSON.parse(
      await openCredential(
        this.coordinator.env,
        row.ownerId,
        `verification:${this.store.key(row.taskId, row.plan.operationId)}`,
        row.revision,
        row.private,
      ),
    );
  }
  async readMessages(claimed, row, startedAt = row.startedAt) {
    const account = this.requireCurrent(claimed, row);
    const token = await this.coordinator.accountConnections.secret(
      row.ownerId,
      account,
    );
    this.requireCurrent(claimed, row);
    const read =
      this.coordinator.verificationMessageProvider?.(row.plan.provider) ??
      verificationMessages(row.plan.provider);
    const messages = await read(
      { ...row, startedAt, expiresAt: row.plan.expiresAt },
      token,
    );
    this.requireCurrent(claimed, row);
    return messages;
  }
  async prepare(claimed, rawPlan) {
    const plan = verificationPlan(rawPlan);
    const task = this.requireClaim(claimed);
    const now = this.coordinator.now();
    this.maintain(now);
    if (plan.expiresAt <= now || plan.expiresAt > now + 3600000)
      throw conflict();
    let row = this.store.get(task.id, plan.operationId);
    if (row) {
      if (JSON.stringify(row.plan) !== JSON.stringify(plan)) throw conflict();
      if (row.status !== "preparing") return summary(row);
      this.requireCurrent(claimed, row);
    } else {
      const identity = this.coordinator.agentIdentity.store.get(
        plan.provider,
      )?.channel;
      if (identity?.status !== "ready")
        throw new HttpError(409, "Connect the agent identity privately first.");
      const account = this.coordinator.accountConnections.get(
        identity.connectionId,
      );
      if (
        this.store
          .entries()
          .some(
            (entry) =>
              !terminal.includes(entry.status) &&
              entry.plan.provider === plan.provider &&
              entry.recipient === identity.address &&
              entry.plan.sender.toLowerCase() === plan.sender.toLowerCase(),
          )
      )
        throw new HttpError(
          409,
          "Finish the existing verification from this sender first.",
        );
      row = {
        ownerId: task.ownerId,
        taskId: task.id,
        stepId: task.stepId,
        plan,
        connectionId: identity.connectionId,
        connectionRevision: account.connection.revision,
        identityRevision: identity.revision,
        resourceId: identity.resourceId,
        recipient: identity.address,
        startedAt: now,
        baseline: [],
        revision: 1,
        status: "preparing",
        dispatched: false,
      };
      this.coordinator.ctx.storage.transactionSync(() => {
        this.requireClaim(claimed);
        this.store.save(row, null, 0);
      });
      row = this.store.get(task.id, plan.operationId);
    }
    await this.coordinator.scheduleMaintenance(this.coordinator.now());
    // Read a baseline before the trusted signup runner requests a new code.
    const messages = await this.readMessages(
      claimed,
      row,
      Math.max(0, row.startedAt - 300000),
    );
    row = await this.change(claimed, row, {
      baseline: messages.map((message) => message.id),
      status: "prepared",
    });
    await this.coordinator.scheduleMaintenance(this.coordinator.now());
    return summary(row);
  }
  async activate(claimed, operationId) {
    const row = this.store.get(claimed.id, operationId);
    if (!row || row.status !== "prepared") throw conflict();
    return summary(
      await this.change(claimed, row, {
        status: "waiting",
        startedAt: this.coordinator.now(),
      }),
    );
  }
  async poll(claimed, operationId) {
    let row = this.store.get(claimed.id, operationId);
    if (!row) throw conflict();
    this.requireCurrent(claimed, row);
    if (row.status !== "waiting") return summary(row);
    const result = matchVerification(
      await this.readMessages(claimed, row),
      row,
      this.coordinator.now(),
    );
    if (result.status === "waiting") return summary(row);
    row = await this.change(
      claimed,
      row,
      {
        status:
          result.status === "ambiguous" ? "needs_attention" : result.status,
      },
      result.proof ?? null,
    );
    return summary(row);
  }
  async consume(claimed, operationId, trustedConsumer) {
    let row = this.store.get(claimed.id, operationId);
    if (!row) throw conflict();
    this.requireCurrent(claimed, row);
    if (row.status !== "ready") return summary(row);
    const proof = await this.privateProof(row);
    row = await this.change(
      claimed,
      row,
      { status: "consuming", dispatched: true },
      proof,
    );
    // Persist dispatch before releasing the proof. Lost replies require lookup, never a second submission.
    let verified = false;
    const deadlineAt = Math.min(claimed.claim.expiresAt, row.plan.expiresAt);
    const controller = new AbortController();
    const activeKey = this.store.key(row.taskId, operationId);
    this.active.set(activeKey, controller);
    const runnerSignal = this.coordinator.active.get(claimed.id)?.signal;
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(Math.max(1, deadlineAt - this.coordinator.now())),
      ...(runnerSignal ? [runnerSignal] : []),
    ]);
    let abort;
    const stopped = new Promise((resolve) => {
      abort = () => resolve(false);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
    try {
      verified = await Promise.race([
        Promise.resolve()
          .then(() => {
            this.requireCurrent(claimed, row);
            return trustedConsumer({ code: proof.code, operationId, signal });
          })
          .then(
            (value) => value === true,
            () => false,
          ),
        stopped,
      ]);
    } finally {
      signal.removeEventListener("abort", abort);
      controller.abort();
      if (this.active.get(activeKey) === controller)
        this.active.delete(activeKey);
    }
    try {
      return summary(
        await this.change(claimed, row, {
          status: verified ? "consumed" : "needs_attention",
        }),
      );
    } catch {
      // Stop/account changes win over late responses. Never return or re-submit the proof.
      const saved = this.store.get(row.taskId, operationId);
      this.maintain(this.coordinator.now());
      return saved
        ? summary(this.store.get(row.taskId, operationId) ?? saved)
        : { ...summary(row), status: "expired" };
    }
  }
  maintain(now) {
    for (const row of this.store.entries()) {
      if (terminal.includes(row.status)) continue;
      const task = this.coordinator.repository
        .records()
        .find((task) => task.id === row.taskId);
      const identity = this.coordinator.agentIdentity.store.get(
        row.plan.provider,
      )?.channel;
      const connection = this.coordinator.connections.get(row.connectionId);
      if (
        !task ||
        ["stopped", "ready"].includes(task.state) ||
        task.stepId !== row.stepId
      ) {
        for (const entry of this.store
          .entries()
          .filter((item) => item.taskId === row.taskId))
          this.active
            .get(this.store.key(entry.taskId, entry.plan.operationId))
            ?.abort();
        this.store.cancel(row.taskId);
      } else if (
        identity?.connectionId !== row.connectionId ||
        identity.resourceId !== row.resourceId ||
        identity.address !== row.recipient ||
        identity.status !== "ready" ||
        connection?.revision !== row.connectionRevision ||
        connection.status !== "connected"
      ) {
        this.active
          .get(this.store.key(row.taskId, row.plan.operationId))
          ?.abort();
        this.store.cancel(row.taskId, row.plan.operationId);
      }
    }
    this.store.expire(now);
    for (const [key, controller] of this.active) {
      const [taskId, operationId] = JSON.parse(key);
      const row = this.store.get(taskId, operationId);
      if (!row || terminal.includes(row.status)) controller.abort();
    }
  }
  nextWakeup(now) {
    const times = this.store
      .entries()
      .filter(
        (row) => !terminal.includes(row.status) && row.plan.expiresAt > now,
      )
      .map((row) => row.plan.expiresAt);
    return times.length ? Math.min(...times) : null;
  }
}
