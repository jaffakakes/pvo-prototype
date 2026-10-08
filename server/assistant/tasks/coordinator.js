import { repairReport } from "../maintenance/repair.js";
import { baselineRunning } from "../maintenance/repair.js";
import { runInitialRepairBaseline } from "../maintenance/observation.js";
import {
  AccountConnections,
  manageAccountConnections,
  installedConnectionProvider,
} from "../../connections/management.js";
import { ConnectionCatalog } from "../../connections/catalog.js";
import { draftTestResults } from "../drafts/testResults.js";
import { SERVICE_EXECUTION_LIMITS } from "../../../packages/pvo-assistant/services/index.js";
import { runDraftTestPreparation } from "../drafts/testing.js";
import { planDraftEdit } from "../drafts/planner.js";
import { runDraftStep } from "../drafts/runner.js";
import { TaskDrafts } from "../drafts/repository.js";
import {
  prepareDraftTaskCreation,
  reconcileDraftStops,
} from "../drafts/creation.js";
import { manageHostedServices } from "../../cloud-services/management.js";
import { ownedServiceId } from "../../cloud-services/releaseContract.js";
import { ServiceCatalog } from "../../cloud-services/catalog.js";
import { runHostingStep } from "../hosting/runner.js";
import { ServiceArtifacts } from "../validation/artifacts.js";
import { ServiceValidationJournal } from "../validation/journal.js";
import { runServiceValidation } from "../validation/runner.js";
import { runServiceStep } from "../validation/cases.js";
import { taskSpendingAllowed } from "./spending.js";
import { claimNextTask } from "./scheduling.js";
import { TaskResearch } from "../builder/researchJournal.js";
import { publicResearch } from "../builder/researchProvider.js";
import { taskBuilderTools } from "../builder/taskToolsRegistry.js";
import { TaskBuilders } from "../builder/repository.js";
import { planSavedBuild } from "../builder/planner.js";
import { runBuilderBatch } from "../builder/runner.js";
import { taskWorkspaceTools } from "../builder/taskTools.js";
import { WorkspaceOperations } from "./workspaceOperations.js";
import { workspaceProvider } from "./workspaceProvider.js";
import {
  runWorkspaceOperation,
  reconcileTaskWorkspaces,
} from "./workspaceRunner.js";
import { ProviderOperations } from "./providerOperations.js";
import { serviceProvider } from "./serviceProvider.js";
import { publishTaskService, reconcileTaskServices } from "./providerRunner.js";

import { TaskResults } from "./results.js";
import {
  assertTaskExecution,
  TASK_LIMITS,
} from "../../../packages/pvo-assistant/tasks/index.js";
import { TaskAttempts } from "./attempts.js";
import { planSavedTask, savedPlannerAvailable } from "./planner.js";
import { runAuthoringStep, settleAuthoringBudgets } from "./runner.js";
import { DurableObject } from "cloudflare:workers";
import { compilePvoComponent } from "../../../packages/pvo-language/worker.js";
import { planTaskAttachment } from "../attachments/planner.js";
import { HttpError } from "../../http.js";
import { randomId } from "../../identity.js";
import { TaskProgress } from "./progress.js";
import { TaskRepairs } from "./repairs.js";
import { TaskEvidence } from "./evidence.js";
import { TaskRepository } from "./repository.js";
import {
  creationDigest,
  creationInput,
  creatorCommand,
  projectInput,
  taskId,
  taskListInput,
} from "./input.js";

// Allow the native model's full text attempt, then leave time to settle its receipt.
const AUTHORING_TIMEOUT_MS = 60000;
const AUTHORING_CLAIM_MS = AUTHORING_TIMEOUT_MS + 15000;

/** Private binding: only trusted routes select the object using the authenticated owner. */
export class AssistantTasks extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.repository = new TaskRepository(ctx.storage.sql);
    this.results = new TaskResults(ctx.storage.sql);
    this.drafts = new TaskDrafts(ctx.storage.sql);
    this.services = new ServiceCatalog(ctx.storage.sql);
    this.connections = new ConnectionCatalog(ctx.storage.sql);
    this.accountConnections = new AccountConnections(this);
    this.providers = new ProviderOperations(
      ctx.storage.sql,
      this.repository,
      this.services,
    );
    this.workspaces = new WorkspaceOperations(ctx.storage.sql, this.repository);
    this.attempts = new TaskAttempts(ctx.storage.sql, this.repository);
    this.builders = new TaskBuilders(ctx.storage.sql, this.repository);
    this.research = new TaskResearch(ctx.storage.sql, this.repository);
    this.validation = new ServiceValidationJournal(
      ctx.storage.sql,
      this.repository,
    );
    this.artifacts = new ServiceArtifacts(ctx.storage.sql, this.repository);
    this.progress = new TaskProgress(ctx.storage.sql);
    this.repairs = new TaskRepairs(ctx.storage.sql);
    this.evidence = new TaskEvidence(ctx.storage.sql);
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
    else if (
      ["read", "result", "tests", "diagnostics"].includes(operation.kind)
    )
      taskId(operation.id);
    else if (["answers", "resume", "stop", "manual"].includes(operation.kind)) {
      taskId(operation.id);
      input = creatorCommand(operation.kind, operation.input);
    } else throw new Error("Unsupported internal task operation");
    const digest =
      operation.kind === "create" ? await creationDigest(input) : null;
    let startingDraft = null;
    try {
      if (operation.kind === "create")
        startingDraft = await prepareDraftTaskCreation(this, ownerId, input);
    } catch (error) {
      if (error instanceof HttpError)
        return { error: error.message, status: error.status };
      throw error;
    }
    // SQL state and its next alarm commit together. No provider/network effects occur here.
    const result = await this.ctx.storage.transaction(async () => {
      const now = this.now();
      const repository = this.repository;
      repository.bindOwner(ownerId);
      this.noteTerminal(now);
      repository.maintain(now, this.heldTasks());
      this.results.prune();
      this.drafts.prune();
      this.evidence.prune();
      this.repairs.prune();
      this.progress.prune();
      this.builders.prune(now);
      this.research.prune(now);
      this.validation.prune(now);
      this.artifacts.prune(now);
      let result;
      try {
        result = this.ctx.storage.transactionSync(() => {
          switch (operation.kind) {
            case "project":
              return {
                project: repository.project(input.localId, randomId(), now),
              };
            case "create": {
              const created = repository.create(input, {
                id: randomId(),
                ownerId,
                now,
                inputDigest: digest,
              });
              if (startingDraft)
                this.drafts.initialize(created.task.id, startingDraft);
              return created;
            }
            case "list":
              return repository.list(input, now);
            case "read":
              return { task: repository.read(operation.id, now) };
            case "diagnostics": {
              const task = repository.read(operation.id, now);
              return {
                reference: {
                  ownerId: task.ownerId,
                  projectId: task.input.projectId,
                  taskId: task.id,
                },
                stepId: task.stepId,
                repair: this.repairs.context(task),
              };
            }
            case "tests":
              return {
                repair: repairReport(this.drafts.get(operation.id) ?? {}),
                tests: draftTestResults(
                  this,
                  repository.read(operation.id, now),
                ),
              };
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
      if (operation.kind === "stop" && result.task?.input.context.container)
        this.drafts.stopping(result.task.id, now);
      this.noteTerminal(now);
      await this.scheduleMaintenance(now);
      return result;
    });
    if (operation.kind === "stop" && result.task?.state === "stopped")
      this.active.get(operation.id)?.abort();
    if (operation.kind === "stop" && result.task?.input.context.container)
      await reconcileDraftStops(this);
    if (operation.kind === "stop" && this.drafts.get(operation.id)?.stopPending)
      return {
        error:
          "The editing task is stopped, but an in-flight save is still being fenced. Retry to confirm.",
        status: 503,
      };
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

  noteTerminal(now) {
    this.providers.noteTerminal(now);
    this.workspaces.noteTerminal(now);
  }
  heldTasks() {
    return new Set([
      ...this.providers.heldTasks(),
      ...this.workspaces.heldTasks(),
    ]);
  }
  awaiting(id) {
    return this.providers.awaiting(id) || this.workspaces.awaiting(id);
  }

  workspaceProvider() {
    return workspaceProvider(this.env);
  }
  workspaceTimeoutMs() {
    return 30000;
  }

  /** Private builder capability: the task selects ownership and the current execution grant. */
  async workspaceOperation(ownerId, id, kind, request, guard) {
    const claimed = await this.claimForOperation(ownerId, id, guard);
    return runWorkspaceOperation(this, claimed, kind, request);
  }

  researchProvider() {
    return publicResearch();
  }
  builderToolDefinitions() {
    return taskBuilderTools(this, null).definitions;
  }

  workspaceToolDefinitions() {
    return taskWorkspaceTools(this, null).definitions;
  }

  async workspaceTool(ownerId, id, tool, operationId, guard) {
    const claimed = await this.claimForOperation(ownerId, id, guard);
    return taskWorkspaceTools(this, claimed).execute(tool, operationId);
  }

  async claimForOperation(ownerId, id, guard) {
    taskId(ownerId);
    taskId(id);
    if (!guard || !Number.isSafeInteger(guard.expectedRevision) || !guard.claim)
      throw new HttpError(409, "A current execution claim is required.");
    return this.transaction(() => {
      this.repository.bindOwner(ownerId);
      const task = this.repository.read(id, this.now());
      assertTaskExecution(task, {
        ownerId,
        expectedRevision: guard.expectedRevision,
        claim: guard.claim,
        now: this.now(),
      });
      return task;
    });
  }

  manageConnections(ownerId, operation) {
    return manageAccountConnections(this, ownerId, operation);
  }
  connectionProvider() {
    return installedConnectionProvider();
  }

  manageServices(ownerId, operation) {
    return manageHostedServices(this, ownerId, operation);
  }

  serviceProvider() {
    return serviceProvider(this.env);
  }
  providerTimeoutMs() {
    return 5000;
  }

  /** Trusted authoring capability. No browser route or model tool can select publication metadata. */
  async publishService(ownerId, id, guard) {
    taskId(ownerId);
    taskId(id);
    const claimed = await this.transaction(() => {
      this.repository.bindOwner(ownerId);
      const task = this.repository.read(id, this.now());
      const current = {
        ownerId,
        expectedRevision: guard.expectedRevision,
        claim: guard.claim,
        now: this.now(),
      };
      assertTaskExecution(task, current);
      return task;
    });
    return publishTaskService(this, claimed);
  }

  validationAvailable() {
    return Boolean(
      this.workspaceProvider() &&
      typeof this.env.SERVICE_NODE_EXECUTION?.getByName === "function",
    );
  }
  async runValidationStep(claimed, artifact, index, cursor, signal) {
    return runServiceStep(
      this.env.SERVICE_NODE_EXECUTION,
      artifact.package,
      artifact.agreement,
      artifact.identity.agreementDigest,
      index,
      cursor,
      {
        ownerId: claimed.ownerId,
        serviceId:
          claimed.input.context.container?.serviceId ??
          (await ownedServiceId(claimed)),
        mode: "validation",
      },
      signal,
    );
  }

  stepTimeoutMs() {
    return AUTHORING_TIMEOUT_MS;
  }
  leaseMs(task) {
    if (task?.stepId === "validate")
      return SERVICE_EXECUTION_LIMITS.validationClaimMs;
    const planning =
      ["plan", "attach"].includes(task?.stepId) ||
      (task?.stepId === "build" && this.builders.stage(task.id) === "model");
    return planning ? AUTHORING_CLAIM_MS : TASK_LIMITS.defaultLeaseMs;
  }
  spendingAllowed(task, capability) {
    return taskSpendingAllowed(this.env, task.ownerId, capability, this.now());
  }
  plannerAvailable() {
    return savedPlannerAvailable(this.env);
  }
  compileAttachment(type, source) {
    return compilePvoComponent(type, source);
  }

  plan(task, signal, input) {
    if (task.input.context.container && task.stepId === "plan")
      return planDraftEdit(task, input.draft, this.env, signal, input.evidence);
    if (task.stepId === "attach")
      return planTaskAttachment(
        task,
        input.attachment,
        this.env,
        signal,
        input.evidence,
      );
    if (task.stepId === "build")
      return planSavedBuild(
        task,
        input.build,
        this.builderToolDefinitions(),
        this.env,
        signal,
        input.evidence,
      );
    return planSavedTask(task, this.env, signal, input.evidence);
  }

  async transaction(operation) {
    return this.ctx.storage.transaction(async () => {
      const result = operation();
      this.noteTerminal(this.now());
      await this.scheduleMaintenance(this.now());
      return result;
    });
  }

  claimNext() {
    return claimNextTask(this);
  }

  async scheduleMaintenance(now) {
    const times = [
      this.repository.nextMaintenance(now),
      ...this.drafts.pendingStops().map((entry) => entry.stopPending.nextAt),
      this.attempts.nextBudgetWakeup(),
      this.research.nextWakeup(now),
      this.validation.nextWakeup(now),
      this.providers.nextWakeup(),
      this.workspaces.nextWakeup(),
      ...this.repository
        .records()
        .flatMap((task) =>
          ["queued", "waiting"].includes(task.state)
            ? this.awaiting(task.id)
              ? []
              : [task.nextRunAt]
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
    await this.transaction(() => this.noteTerminal(this.now()));
    await reconcileDraftStops(this);
    await reconcileTaskServices(this);
    await reconcileTaskWorkspaces(this);
    // Durable wakeups run independently of HTTP requests. Each invocation owns at most two steps.
    for (let index = 0; index < 2; index++) {
      const claimed = await this.transaction(() => this.claimNext());
      if (!claimed) break;
      if (
        ["draft_apply", "draft_sync", "draft_finish"].includes(claimed.stepId)
      )
        await runDraftStep(this, claimed);
      else if (claimed.stepId === "host") await runHostingStep(this, claimed);
      else if (claimed.stepId === "validate")
        await runServiceValidation(this, claimed);
      else if (
        claimed.stepId === "build" &&
        this.builders.stage(claimed.id) !== "model"
      )
        await runBuilderBatch(this, claimed);
      else if (
        claimed.input.context.container?.mode === "repair" &&
        !this.drafts.get(claimed.id)?.maintenance
      )
        await runInitialRepairBaseline(this, claimed);
      else if (
        claimed.input.context.container?.mode === "test" ||
        baselineRunning(this, claimed) ||
        (claimed.input.context.container?.mode === "repair" &&
          claimed.stepId === "build")
      )
        await runDraftTestPreparation(this, claimed);
      else await runAuthoringStep(this, claimed);
    }
    await settleAuthoringBudgets(this);
    await this.transaction(() => {
      this.attempts.prune();
      this.evidence.prune();
      this.repairs.prune();
      this.progress.prune();
      this.providers.prune();
      this.workspaces.prune(this.now());
      this.builders.prune(this.now());
      this.research.prune(this.now());
      this.validation.prune(this.now());
      this.artifacts.prune(this.now());
    });
  }
}
