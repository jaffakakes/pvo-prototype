import { AssistantTasks } from "../../../server/assistant/tasks/coordinator.js";
import { planSavedTask } from "../../../server/assistant/tasks/planner.js";
import { planSavedBuild } from "../../../server/assistant/builder/planner.js";
import { planTaskAttachment } from "../../../server/assistant/attachments/planner.js";
import { meteredModels } from "./meter.js";
import { scenarioInput, scenarios } from "./scenarios.js";
import { acceptanceFaults, injectSourceFault } from "./faults.js";

export const proofOwner = (env, subject) => `proof-${env.PROOF_ID}-${subject}`;

/** Runs the product planners, runner, tools and gates. Extra methods only observe/control the diagnostic. */
export class AcceptanceTasks extends AssistantTasks {
  constructor(ctx, env) {
    super(ctx, env);
    this.faults = acceptanceFaults(ctx.storage);
  }
  async plan(task, signal, input) {
    const models = meteredModels(
      this.env,
      this.env.PROOF_CONTROL.getByName("global"),
    );
    if (task.stepId === "attach")
      return planTaskAttachment(
        task,
        input.attachment,
        this.env,
        signal,
        input.evidence,
        models,
      );
    if (task.stepId === "build") {
      const decision = await planSavedBuild(
        task,
        input.build,
        this.builderToolDefinitions(),
        this.env,
        signal,
        input.evidence,
        models,
      );
      if (
        task.ownerId === proofOwner(this.env, "dinner") &&
        !this.faults.has("source")
      ) {
        const fault = injectSourceFault(decision);
        if (fault) {
          this.faults.save("source", {
            taskId: task.id,
            path: fault.path,
            originalDecision: decision,
          });
          return fault.decision;
        }
      }
      return decision;
    }
    return planSavedTask(task, this.env, signal, input.evidence, models);
  }
  serviceProvider() {
    const provider = super.serviceProvider();
    if (!provider) return null;
    return {
      ...provider,
      publish: async (publication) => {
        if (publication.identity.ownerId !== proofOwner(this.env, "dinner"))
          return provider.publish(publication);
        if (!this.faults.has("hosting_unavailable")) {
          this.faults.save("hosting_unavailable", {
            identity: publication.identity,
          });
          throw new Error(
            "Deliberate acceptance hosting failure before dispatch",
          );
        }
        const result = await provider.publish(publication);
        if (!this.faults.has("hosting_lost_reply")) {
          this.faults.save("hosting_lost_reply", {
            identity: publication.identity,
          });
          this.ctx.abort(
            "Acceptance restarts the authoring worker after real hosting committed, before its receipt is saved",
          );
        }
        return result;
      },
    };
  }
  async begin(subject) {
    if (!scenarios[subject]) throw new Error("Unknown scenario.");
    const ownerId = proofOwner(this.env, subject);
    const { project } = await this.execute(ownerId, {
      kind: "project",
      input: { localId: `acceptance-${subject}` },
    });
    return this.execute(ownerId, {
      kind: "create",
      input: scenarioInput(subject, project.id),
    });
  }
  async snapshot(subject) {
    const ownerId = proofOwner(this.env, subject);
    this.repository.bindOwner(ownerId);
    const task = this.repository.records()[0];
    const workspaces = [];
    for (const link of this.workspaces.links()) {
      const stub = this.env.ASSISTANT_WORKSPACES.getByName(
        link.identity.resourceId,
      );
      workspaces.push({
        identity: link.identity,
        observation: await stub.lookup(link.identity),
        absent: await stub.isAbsent(),
      });
    }
    return {
      task: task ?? null,
      build: task ? this.builders.get(task.id) : null,
      workspaces,
      services: this.services.services(),
      validations: this.validation.entries(),
      faults: this.faults.report(),
      result: task?.state === "ready" ? this.results.read(task) : null,
    };
  }
  async dispose(subject) {
    const ownerId = proofOwner(this.env, subject);
    const tasks = this.repository.records();
    for (const task of tasks) {
      if (!["ready", "stopped", "failed"].includes(task.state))
        await this.execute(ownerId, {
          kind: "stop",
          id: task.id,
          input: { expectedRevision: task.revision },
        });
    }
    const workspaces = [];
    for (const link of this.workspaces.links()) {
      const stub = this.env.ASSISTANT_WORKSPACES.getByName(
        link.identity.resourceId,
      );
      await stub.stop(link.identity);
      workspaces.push({
        resourceId: link.identity.resourceId,
        absent: await stub.isAbsent(),
      });
    }
    return { workspaces };
  }
  restart() {
    this.ctx.abort(
      "Acceptance: restart the authoring worker with its saved notebook intact",
    );
  }
}
