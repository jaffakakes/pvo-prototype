import { AssistantTasks } from "../../../server/assistant/tasks/coordinator.js";
import { planSavedTask } from "../../../server/assistant/tasks/planner.js";
import { planSavedBuild } from "../../../server/assistant/builder/planner.js";
import { planTaskAttachment } from "../../../server/assistant/attachments/planner.js";
import { meteredModels } from "./meter.js";
import { scenarioInput, scenarios } from "./scenarios.js";

export const proofOwner = (env, subject) => `proof-${env.PROOF_ID}-${subject}`;

/** Runs the product planners, runner, tools and gates. Extra methods only observe/control the diagnostic. */
export class AcceptanceTasks extends AssistantTasks {
  plan(task, signal, input) {
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
    if (task.stepId === "build")
      return planSavedBuild(
        task,
        input.build,
        this.builderToolDefinitions(),
        this.env,
        signal,
        input.evidence,
        models,
      );
    return planSavedTask(task, this.env, signal, input.evidence, models);
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
