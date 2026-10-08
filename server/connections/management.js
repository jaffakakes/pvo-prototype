import { GITHUB_OPERATIONS } from "../../packages/pvo-assistant/connections/index.js";
import { HttpError } from "../http.js";
import { taskId } from "../assistant/tasks/input.js";
import { connectionCommand } from "./input.js";
import {
  protectCredential,
  openCredential,
  connectionSetupAvailable,
} from "./credentials.js";
import { githubAdapter, GitHubAccessError } from "./providers/github.js";
import { ConnectionStore } from "./store.js";

/** Coordinates account scope, credential lifetime, and CAS fences around provider reads. */
export class AccountConnections {
  constructor(coordinator) {
    this.coordinator = coordinator;
    this.catalog = coordinator.connections;
    this.store = new ConnectionStore(coordinator.ctx.storage.sql);
  }
  expire() {
    for (const { id } of this.store.sql
      .exec("SELECT id FROM account_connection_secrets")
      .toArray()) {
      const current = this.get(id);
      if (
        current.connection.status === "connected" &&
        current.details.expiresAt !== null &&
        current.details.expiresAt <= this.coordinator.now()
      )
        this.invalidate(current, "expired");
    }
  }
  get(id) {
    const connection = this.catalog.get(id),
      stored = this.store.get(id);
    if (!connection || !stored)
      throw new HttpError(
        404,
        "This connection is unavailable for your account.",
      );
    if (connection.revision !== stored.revision)
      throw new HttpError(
        503,
        "Connection storage needs repair. Contact the server operator.",
      );
    return { connection, ...stored };
  }
  public(current) {
    return {
      connection: current.connection,
      scope: current.details.scope,
      account: current.details.login,
      expiresAt: current.details.expiresAt,
      checkedAt: current.details.checkedAt,
    };
  }
  same(id, revision) {
    const current = this.get(id);
    if (current.connection.revision !== revision)
      throw new HttpError(
        409,
        "This connection changed. Refresh its status and retry.",
      );
    return current;
  }
  invalidate(current, status) {
    this.coordinator.ctx.storage.transactionSync(() => {
      this.same(current.id, current.connection.revision);
      const next = {
        ...current.connection,
        revision: current.connection.revision + 1,
        status,
        permissions: [],
      };
      this.catalog.save(next, current.connection.revision);
      this.store.save(current.id, next.revision, current.details, null);
    });
    return this.get(current.id);
  }
  async secret(ownerId, current) {
    if (current.connection.status !== "connected" || !current.credential)
      throw new GitHubAccessError();
    return openCredential(
      this.coordinator.env,
      ownerId,
      current.id,
      current.revision,
      current.credential,
    );
  }
  async execute(ownerId, kind, raw) {
    taskId(ownerId);
    const input = connectionCommand(kind, raw);
    this.coordinator.repository.bindOwner(ownerId);
    this.expire();
    if (kind === "list") {
      const page = this.catalog.page(input.after);
      return {
        available: connectionSetupAvailable(this.coordinator.env),
        items: page.connections
          .filter((item) => this.store.get(item.id))
          .map((item) => this.public(this.get(item.id))),
        next: page.next,
      };
    }
    if (
      !connectionSetupAvailable(this.coordinator.env) &&
      kind !== "disconnect"
    )
      throw new HttpError(
        503,
        "Private account setup is unavailable. Try again later.",
      );
    if (kind === "connect") return this.connect(ownerId, input);
    const current = this.get(input.id);
    if (kind === "disconnect") {
      this.same(input.id, input.expectedRevision);
      return this.public(
        current.connection.status === "revoked"
          ? current
          : this.invalidate(current, "revoked"),
      );
    }
    if (kind === "attach") return this.attach(ownerId, current, input);
    if (kind === "check") this.same(input.id, input.expectedRevision);
    const token = await this.secret(ownerId, current);
    this.same(input.id, current.connection.revision);
    const adapter = this.coordinator.connectionProvider();
    try {
      if (kind === "invoke") {
        const operation = current.connection.operations.find(
          (item) => item.id === input.call.operation,
        );
        if (
          !operation ||
          !operation.permissions.every((permission) =>
            current.connection.permissions.includes(permission),
          )
        )
          throw new HttpError(
            403,
            "This operation is not approved for the connection.",
          );
        const result = await adapter.invoke(
          current.details.scope,
          token,
          input.call,
        );
        this.expire();
        this.same(input.id, current.connection.revision);
        return { result };
      }
      const verified = await adapter.verify(current.details.scope, token);
      if (verified.accountId !== current.details.accountId)
        throw new GitHubAccessError();
      this.expire();
      this.same(input.id, current.connection.revision);
      this.store.save(
        current.id,
        current.revision,
        { ...current.details, checkedAt: this.coordinator.now() },
        current.credential,
      );
      return this.public(this.get(current.id));
    } catch (error) {
      if (
        error instanceof GitHubAccessError &&
        this.catalog.get(current.id)?.revision === current.connection.revision
      )
        this.invalidate(current, "expired");
      throw error;
    }
  }
  async connect(ownerId, input) {
    const previous = this.catalog.get(input.id);
    if ((previous?.revision ?? 0) !== input.expectedRevision)
      throw new HttpError(
        409,
        "This connection changed. Refresh its status before reconnecting.",
      );
    const prior = previous ? this.get(input.id) : null;
    if (prior && prior.details.scope.repository !== input.setup.repository)
      throw new HttpError(
        409,
        "Reconnect the same repository, or create a separate connection.",
      );
    const verified = await this.coordinator
      .connectionProvider()
      .verify(input.setup, input.token);
    if (prior && prior.details.accountId !== verified.accountId)
      throw new HttpError(409, "Reconnect with the same GitHub account.");
    if (
      verified.expiresAt !== null &&
      verified.expiresAt <= this.coordinator.now()
    )
      throw new GitHubAccessError();
    const revision = input.expectedRevision + 1;
    const credential = await protectCredential(
      this.coordinator.env,
      ownerId,
      input.id,
      revision,
      input.token,
    );
    this.coordinator.ctx.storage.transactionSync(() => {
      if (
        (this.catalog.get(input.id)?.revision ?? 0) !== input.expectedRevision
      )
        throw new HttpError(
          409,
          "This connection changed while access was checked. Refresh its status.",
        );
      this.catalog.save(
        {
          id: input.id,
          name: `GitHub · ${input.setup.repository}`,
          provider: "github",
          status: "connected",
          revision,
          permissions: ["repository:read", "issues:read"],
          operations: structuredClone(GITHUB_OPERATIONS),
        },
        input.expectedRevision,
      );
      this.store.save(
        input.id,
        revision,
        { ...verified, checkedAt: this.coordinator.now() },
        credential,
      );
    });
    return this.public(this.get(input.id));
  }
  async attach(ownerId, current, input) {
    if (current.connection.status !== "connected")
      throw new GitHubAccessError();
    return this.coordinator.transaction(() => {
      this.expire();
      this.same(current.id, current.connection.revision);
      const task = this.coordinator.repository.read(
        input.taskId,
        this.coordinator.now(),
      );
      const question =
        task.questions.find((item) => item.id === input.questionId) ??
        this.coordinator.repository.questions.get(task.id, input.questionId);
      if (
        !question?.connection ||
        question.connection.repository !== current.details.scope.repository ||
        question.connection.provider !== "github"
      )
        throw new HttpError(
          409,
          "This connection does not match the saved task's account request.",
        );
      if (question.answer?.connectionId === current.id) return { task };
      const next = this.coordinator.repository.update(
        task.id,
        {
          kind: "answer_connection",
          questionId: question.id,
          questionRevision: 0,
          operationId: input.operationId,
          value: `Connected GitHub repository ${current.details.scope.repository}.`,
          connectionId: current.id,
        },
        {
          ownerId,
          expectedRevision: input.expectedRevision,
          now: this.coordinator.now(),
          claim: null,
        },
      );
      return { task: next };
    });
  }
}

export async function manageAccountConnections(
  coordinator,
  ownerId,
  operation,
) {
  try {
    return {
      ok: true,
      value: await coordinator.accountConnections.execute(
        ownerId,
        operation.kind,
        operation.input,
      ),
    };
  } catch (error) {
    return {
      ok: false,
      status: error instanceof HttpError ? error.status : 503,
      error:
        error instanceof HttpError
          ? error.message
          : "This connection could not respond. Refresh its status and retry.",
    };
  }
}
export const installedConnectionProvider = () => githubAdapter();
