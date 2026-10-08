import { AssistantTasks } from "../../../server/assistant/tasks/coordinator.js";
import {
  ownedServiceId,
  prepareServicePublication,
} from "../../../server/cloud-services/releaseContract.js";
import {
  taskClaim,
  transitionGuard,
} from "../../../server/assistant/tasks/executionClaim.js";
import { reconcileTaskServices } from "../../../server/assistant/tasks/providerRunner.js";
import { installCheckedDiagnostic } from "../cloud-agent-recovery/checked-fixture.js";
import { checkProductArtifact } from "./artifact.js";

export const productOwner = (env) => `node-${env.PROOF_ID}`;

/** Fixed acceptance setup uses real validation and publication. It cannot supply a synthetic passing report. */
export class ProductTasks extends AssistantTasks {
  constructor(ctx, env) {
    super(ctx, env);
    this.instanceId = crypto.randomUUID();
  }
  now() {
    return Date.now() + (this.advance ?? 0);
  }
  async scheduleMaintenance() {
    await this.ctx.storage.setAlarm(Number(this.env.PROOF_EXPIRES_AT));
  }
  serviceProvider() {
    const provider = super.serviceProvider();
    return {
      ...provider,
      publish: async (publication) => {
        const result = await provider.publish(publication);
        if (this.losePublication)
          this.ctx.abort("Controlled crash after committed publication");
        return result;
      },
    };
  }
  checkArtifact(scope, variant) {
    return checkProductArtifact(
      this.env.SERVICE_NODE_EXECUTION,
      scope,
      variant,
    );
  }
  async begin() {
    const ownerId = productOwner(this.env);
    const { project } = await this.execute(ownerId, {
      kind: "project",
      input: { localId: "node-product" },
    });
    const { task } = await this.execute(ownerId, {
      kind: "create",
      input: {
        operationId: "node-product",
        projectId: project.id,
        request: "Verify the integrated Node Container lifecycle.",
        examples: [],
        context: {
          fingerprint: "100-node-proof",
          currentSceneId: "main",
          scenes: [{ id: "main", name: "Main", duration: 10 }],
          components: [],
        },
      },
    });
    if (this.providers.entries().length) return this.snapshot();
    let claimed = await this.transition(task, [
      { kind: "claim", claimId: "prepare", leaseMs: 60000 },
      { kind: "checkpoint", stepId: "validate" },
      { kind: "claim", claimId: "validate", leaseMs: 330000 },
    ]);
    const checked = await this.checkArtifact(
      { ownerId, serviceId: await ownedServiceId(claimed), mode: "validation" },
      "initial",
    );
    if (checked.report.status !== "passed")
      throw new Error(`Independent validation ${checked.report.status}`);
    claimed = await this.transition(claimed, [
      { kind: "checkpoint", stepId: "host" },
      { kind: "claim", claimId: "publish", leaseMs: 60000 },
    ]);
    await installCheckedDiagnostic(this, claimed, checked);
    this.losePublication = true;
    await this.publishService(ownerId, claimed.id, {
      expectedRevision: claimed.revision,
      claim: taskClaim(claimed),
    });
    return this.snapshot();
  }
  transition(task, commands) {
    return this.transaction(() => {
      let current = task;
      for (const command of commands)
        current = this.repository.update(
          current.id,
          command,
          transitionGuard(
            current,
            this.now(),
            command.kind === "claim" ? null : taskClaim(current),
          ),
        );
      return current;
    });
  }
  async snapshot() {
    const row = this.providers.entries()[0];
    return {
      instanceId: this.instanceId,
      task: this.repository.records()[0] ?? null,
      row: row
        ? { ...row, publication: row.publication ? "retained" : null }
        : null,
      provider: row ? await super.serviceProvider().lookup(row.identity) : null,
    };
  }
  async reconcile() {
    this.advance = 120000;
    await reconcileTaskServices(this);
    return this.snapshot();
  }
  async version(variant) {
    const row = this.providers.entries()[0];
    if (!row) throw new Error("Publish initial version first");
    const checked = await this.checkArtifact(
      {
        ownerId: row.identity.ownerId,
        serviceId: row.identity.serviceId,
        mode: "validation",
      },
      variant,
    );
    if (checked.report.status !== "passed") return { report: checked.report };
    const task = this.repository.records()[0];
    const publication = await prepareServicePublication(
      task,
      variant,
      checked,
      Date.now() + 3600000,
      row.identity.serviceId,
    );
    await this.transaction(() =>
      this.services.intent(task, publication, this.now()),
    );
    const result = await super.serviceProvider().publish(publication);
    await this.transaction(() =>
      this.services.observe(publication.identity, result.state, this.now()),
    );
    return {
      identity: publication.identity,
      report: checked.report,
      observation: result,
    };
  }
  restart() {
    this.ctx.abort("Controlled task restart");
  }
  async alarm() {
    await reconcileTaskServices(this);
  }
}
