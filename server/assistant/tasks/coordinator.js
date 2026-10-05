import { TaskResults } from "./results.js";
import {
  transitionTask,
  TASK_LIMITS,
} from "../../../packages/pvo-assistant/tasks/index.js";
import { TaskAttempts } from "./attempts.js";
import { planSavedTask, savedPlannerAvailable } from "./planner.js";
import { runAuthoringStep, settleAuthoringBudgets } from "./runner.js";
import { DurableObject } from "cloudflare:workers";
import { HttpError } from "../../http.js";
import { randomId } from "../../identity.js";
import { TaskRepository } from "./repository.js";
import {
  creationDigest,
  creationInput,
  creatorCommand,
  projectInput,
  taskId,
  taskListInput,
} from "./input.js";

/** Private binding: only trusted routes select the object using the authenticated owner. */
export class AssistantTasks extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.repository = new TaskRepository(ctx.storage.sql);
    this.results = new TaskResults(ctx.storage.sql);
    this.attempts = new TaskAttempts(ctx.storage.sql, this.repository);
    this.active = new Map();
  }

  now() {
    return Date.now();
  }

  async execute(ownerId, operation) {
    taskId(ownerId);
    let input;
    if (operation.kind === "project") input = projectInput(operation.input);
    else if (operation.kind === "create")
      input = creationInput(operation.input);
    else if (operation.kind === "list")
      input = taskListInput(new URLSearchParams(operation.query));
    else if (["read", "result"].includes(operation.kind)) taskId(operation.id);
    else if (["answers", "resume", "stop"].includes(operation.kind)) {
      taskId(operation.id);
      input = creatorCommand(operation.kind, operation.input);
    } else throw new Error("Unsupported internal task operation");
    const digest =
      operation.kind === "create" ? await creationDigest(input) : null;
    // SQL state and its next alarm commit together. No provider/network effects occur here.
    const result = await this.ctx.storage.transaction(async () => {
      const now = this.now();
      const repository = this.repository;
      repository.bindOwner(ownerId);
      repository.maintain(now);
      this.results.prune();
      let result;
      try {
        result = this.ctx.storage.transactionSync(() => {
          switch (operation.kind) {
            case "project":
              return {
                project: repository.project(input.localId, randomId(), now),
              };
            case "create":
              return repository.create(input, {
                id: randomId(),
                ownerId,
                now,
                inputDigest: digest,
              });
            case "list":
              return repository.list(input, now);
            case "read":
              return { task: repository.read(operation.id, now) };
            case "result":
              return {
                body: this.results.read(repository.read(operation.id, now)),
              };
            default:
              return {
                task: repository.update(operation.id, input.command, {
                  ownerId,
                  expectedRevision: input.expectedRevision,
                  now,
                  claim: null,
                }),
              };
          }
        });
      } catch (error) {
        if (!(error instanceof HttpError)) throw error;
        result = { error: error.message, status: error.status };
      }
      await this.scheduleMaintenance(now);
      return result;
    });
    if (operation.kind === "stop" && result.task?.state === "stopped")
      this.active.get(operation.id)?.abort();
    return result;
  }

  /** Private runner capability: never exposed as a browser command or model tool. */
  async completePreparedResult(ownerId, id, operations, guard) {
    taskId(ownerId);
    taskId(id);
    if (!guard || !Number.isSafeInteger(guard.expectedRevision) || !guard.claim)
      throw new HttpError(409, "A current execution claim is required.");
    this.repository.bindOwner(ownerId);
    const original = this.repository.read(id, this.now());
    const encoded = await this.results.encode(original, operations);
    return this.transaction(() =>
      this.ctx.storage.transactionSync(() => {
        const task = this.repository.read(id, this.now());
        if (task.state === "ready") {
          if (this.results.read(task) !== encoded.body)
            throw new HttpError(409, "A completed result cannot be replaced.");
          return task;
        }
        // Recheck the actual owner, revision, deadline and execution generation after hashing.
        const next = this.repository.update(
          id,
          {
            kind: "complete",
            result: {
              artifact: encoded.artifact,
              baseFingerprint: task.input.context.fingerprint,
            },
          },
          {
            ownerId,
            expectedRevision: guard.expectedRevision,
            claim: guard.claim,
            now: this.now(),
          },
        );
        this.results.save(next, encoded);
        return next;
      }),
    );
  }

  stepTimeoutMs() {
    return 45000;
  }
  leaseMs() {
    return 60000;
  }
  plannerAvailable() {
    return savedPlannerAvailable(this.env);
  }
  plan(task, signal) {
    return planSavedTask(task, this.env, signal);
  }

  async transaction(operation) {
    return this.ctx.storage.transaction(async () => {
      const result = operation();
      await this.scheduleMaintenance(this.now());
      return result;
    });
  }

  claimNext() {
    const now = this.now();
    this.repository.maintain(now);
    for (const [id, controller] of this.active) {
      const task = this.attempts.task(id);
      if (!task || task.state !== "running" || task.claim.expiresAt <= now)
        controller.abort();
    }
    this.attempts.recover(now);
    this.repository.maintain(now);
    this.attempts.prune();
    this.results.prune();
    for (let task of this.repository.records()) {
      if (task.state === "running" && task.claim.expiresAt <= now) {
        const recovered = transitionTask(
          task,
          { kind: "recover" },
          {
            ownerId: task.ownerId,
            expectedRevision: task.revision,
            now,
            claim: null,
          },
        );
        this.repository.save(recovered, task.revision);
        task = recovered;
      }
      if (task.state !== "queued" || task.nextRunAt > now) continue;
      const claimed = this.repository.update(
        task.id,
        { kind: "claim", claimId: randomId(), leaseMs: this.leaseMs() },
        {
          ownerId: task.ownerId,
          expectedRevision: task.revision,
          now,
          claim: null,
        },
      );
      let code = null;
      if (
        claimed.operations.some((operation) =>
          ["unknown", "planned"].includes(operation.status),
        ) ||
        claimed.usage.reservedModelTurns ||
        claimed.usage.reservedToolCalls
      )
        code = "reconciliation_required";
      else if (claimed.stepId !== "plan" || !this.plannerAvailable())
        code = "provider_unavailable";
      else if (claimed.usage.modelTurns >= TASK_LIMITS.modelTurns)
        code = "budget_exceeded";
      if (code) {
        this.repository.update(
          claimed.id,
          { kind: "fail", failure: { code, stepId: claimed.stepId } },
          {
            ownerId: claimed.ownerId,
            expectedRevision: claimed.revision,
            now,
            claim: { id: claimed.claim.id, generation: claimed.generation },
          },
        );
        continue;
      }
      return claimed;
    }
    return null;
  }

  async scheduleMaintenance(now) {
    const times = [
      this.repository.nextMaintenance(now),
      this.attempts.nextBudgetWakeup(),
      ...this.repository
        .records()
        .flatMap((task) =>
          task.state === "queued"
            ? [task.nextRunAt]
            : task.state === "running"
              ? [task.claim.expiresAt]
              : [],
        ),
    ].filter((time) => time !== null);
    if (!times.length) await this.ctx.storage.deleteAlarm();
    else
      await this.ctx.storage.setAlarm(Math.max(now + 10, Math.min(...times)));
  }

  async alarm() {
    // Durable wakeups run independently of HTTP requests. Each invocation owns at most two steps.
    for (let index = 0; index < 2; index++) {
      const claimed = await this.transaction(() => this.claimNext());
      if (!claimed) break;
      await runAuthoringStep(this, claimed);
    }
    await settleAuthoringBudgets(this);
    await this.transaction(() => this.attempts.prune());
  }
}
