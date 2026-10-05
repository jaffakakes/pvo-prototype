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
    else if (operation.kind === "read") taskId(operation.id);
    else if (["answers", "resume", "stop"].includes(operation.kind)) {
      taskId(operation.id);
      input = creatorCommand(operation.kind, operation.input);
    } else throw new Error("Unsupported internal task operation");
    const digest =
      operation.kind === "create" ? await creationDigest(input) : null;
    // SQL state and its next alarm commit together. No provider/network effects occur here.
    return this.ctx.storage.transaction(async () => {
      const now = this.now();
      const repository = this.repository;
      repository.bindOwner(ownerId);
      repository.maintain(now);
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
  }

  async scheduleMaintenance(now) {
    const next = this.repository.nextMaintenance(now);
    if (next === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(next);
  }

  async alarm() {
    await this.ctx.storage.transaction(async () => {
      const now = this.now();
      this.repository.maintain(now);
      await this.scheduleMaintenance(now);
    });
  }
}
