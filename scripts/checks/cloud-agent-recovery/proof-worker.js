import { installCheckedDiagnostic } from "./checked-fixture.js";
import { recoveryCheckedService } from "./checked-service.js";
import { AssistantTasks } from "../../../server/assistant/tasks/coordinator.js";
import { ServiceRelease } from "../../../server/cloud-services/release.js";
import { reconcileTaskServices } from "../../../server/assistant/tasks/providerRunner.js";
import {
  taskClaim,
  transitionGuard,
} from "../../../server/assistant/tasks/executionClaim.js";
import { authorize, mark } from "../cloud-agent-infrastructure/proof-http.js";

export class ProofRelease extends ServiceRelease {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS proof_calls (id INTEGER PRIMARY KEY CHECK (id=1), count INTEGER NOT NULL)",
    );
  }
  async publish(value) {
    this.ctx.storage.sql.exec(
      "INSERT INTO proof_calls VALUES (1,1) ON CONFLICT(id) DO UPDATE SET count=count+1",
    );
    return super.publish(value);
  }
  inspect() {
    return {
      calls:
        this.ctx.storage.sql.exec("SELECT count FROM proof_calls").toArray()[0]
          ?.count ?? 0,
      sourcePresent: this.row()?.body != null,
    };
  }
}

export class ProofTasks extends AssistantTasks {
  constructor(ctx, env) {
    super(ctx, env);
    this.instanceId = crypto.randomUUID();
  }
  // Controlled task time makes crashes and failed-lookup backoff deterministic.
  // The actual release still expires at the real 20-minute proof deadline.
  now() {
    return Number(this.env.PROOF_EXPIRES_AT) - 86400000 + (this.advance ?? 0);
  }
  async scheduleMaintenance() {
    await this.ctx.storage.setAlarm(Number(this.env.PROOF_EXPIRES_AT));
  }
  serviceProvider() {
    const provider = super.serviceProvider();
    return {
      ...provider,
      publish: (publication) => {
        const effect = (async () => {
          if (this.delayPublication) {
            let release;
            const gate = new Promise((resolve) => {
              release = resolve;
            });
            this.releasePublication = release;
            const timeout = setTimeout(release, 15000);
            try {
              await gate;
            } finally {
              clearTimeout(timeout);
            }
          }
          const result = await provider.publish(publication);
          if (this.crashAfterPublication)
            this.ctx.abort(
              "Controlled crash after provider create, before receipt",
            );
          return result;
        })();
        // Retain the deliberately delayed remote effect after the caller observes Stop.
        this.ctx.waitUntil(effect);
        return effect;
      },
      lookup: (identity) => {
        if (this.failLookup) throw new Error("Controlled lookup outage");
        return provider.lookup(identity);
      },
    };
  }
  async begin(mode) {
    const ownerId = this.env.PROOF_ID;
    const { project } = await this.execute(ownerId, {
      kind: "project",
      input: { localId: "provider-proof" },
    });
    const { task } = await this.execute(ownerId, {
      kind: "create",
      input: {
        operationId: mode,
        projectId: project.id,
        request: "Verify the fixed inactive service recovery diagnostic.",
        examples: [],
        context: { fingerprint: "100-proof-proof", components: [] },
      },
    });
    const claimed = await this.transaction(() => {
      let current = task;
      for (const command of [
        { kind: "claim", claimId: "plan-proof", leaseMs: 60000 },
        { kind: "checkpoint", stepId: "host" },
        { kind: "claim", claimId: "publish-proof", leaseMs: 60000 },
      ]) {
        current = this.repository.update(
          current.id,
          command,
          transitionGuard(
            current,
            this.now(),
            command.kind === "claim" ? null : taskClaim(current),
          ),
        );
      }
      return current;
    });
    await installCheckedDiagnostic(
      this,
      claimed,
      await recoveryCheckedService(this.env.SERVICE_LOADER),
    );
    this.crashAfterPublication = mode === "recover";
    this.delayPublication = mode === "cancel";
    await this.publishService(ownerId, claimed.id, {
      expectedRevision: claimed.revision,
      claim: taskClaim(claimed),
    });
    return this.snapshot();
  }
  async snapshot() {
    const rows = this.providers.entries();
    const row = rows[0];
    const task = this.repository.records()[0];
    const release = row
      ? this.env.SERVICE_RELEASES.getByName(row.identity.resourceId)
      : null;
    return {
      instanceId: this.instanceId,
      task,
      row: row
        ? { ...row, publication: row.publication === null ? null : "retained" }
        : null,
      provider: row ? await super.serviceProvider().lookup(row.identity) : null,
      calls: release ? (await release.inspect()).calls : 0,
    };
  }
  async reconcile(failLookup) {
    this.failLookup = failLookup;
    this.advance = failLookup ? 60000 : 120000;
    await this.transaction(() => this.providers.noteTerminal(this.now()));
    await reconcileTaskServices(this);
    return this.snapshot();
  }
  async stop() {
    const task = this.repository.records()[0];
    await this.execute(task.ownerId, {
      kind: "stop",
      id: task.id,
      input: { expectedRevision: task.revision },
    });
    await reconcileTaskServices(this);
    this.releasePublication?.();
    return this.snapshot();
  }
  async replay() {
    this.advance = 120000;
    const task = this.repository.records()[0];
    const claimed = await this.transaction(() =>
      this.repository.update(
        task.id,
        { kind: "claim", claimId: "resumed-proof", leaseMs: 60000 },
        transitionGuard(task, this.now()),
      ),
    );
    await this.publishService(task.ownerId, task.id, {
      expectedRevision: claimed.revision,
      claim: taskClaim(claimed),
    });
    return this.snapshot();
  }
  async probe(input) {
    const { identity } = this.providers.entries()[0];
    try {
      return {
        result: await this.env.SERVICE_RELEASES.getByName(
          identity.resourceId,
        ).probe(identity, {
          operation: "double",
          input: {
            value: input.value ?? 0,
            spin: Boolean(input.spin),
            big: Boolean(input.big),
          },
        }),
      };
    } catch (error) {
      return {
        error: /CPU/i.test(error.message) ? "cpu_limit" : "probe_rejected",
      };
    }
  }
  async cleanup() {
    for (const row of this.providers.entries())
      await super.serviceProvider().cancel(row.identity);
    this.releasePublication?.();
    await this.ctx.storage.deleteAlarm();
    return this.snapshot();
  }
  async alarm() {
    await this.cleanup();
  }
}

export default {
  async fetch(request, env) {
    const denied = authorize(request, env);
    if (denied) return mark(denied, env);
    const { pathname } = new URL(request.url);
    if (request.method === "GET" && pathname === "/health")
      return mark(Response.json({ ready: true }), env);
    if (request.method === "DELETE") {
      const results = [];
      for (const mode of ["recover", "cancel"])
        results.push(
          await env.PROOF_TASKS.getByName(`${env.PROOF_ID}-${mode}`).cleanup(),
        );
      return mark(Response.json({ results }), env);
    }
    const match =
      /^\/(recover|cancel)\/(begin|status|lookup-failure|reconcile|replay|stop|probe|spin|oversize)$/.exec(
        pathname,
      );
    if (!match) return mark(new Response("Not found", { status: 404 }), env);
    const [, mode, action] = match;
    if (request.method !== (action === "status" ? "GET" : "POST"))
      return mark(new Response("Method not allowed", { status: 405 }), env);
    const stub = env.PROOF_TASKS.getByName(`${env.PROOF_ID}-${mode}`);
    try {
      const result =
        action === "begin"
          ? await stub.begin(mode)
          : action === "status"
            ? await stub.snapshot()
            : action === "lookup-failure"
              ? await stub.reconcile(true)
              : action === "reconcile"
                ? await stub.reconcile(false)
                : action === "replay"
                  ? await stub.replay()
                  : action === "stop"
                    ? await stub.stop()
                    : await stub.probe({
                        value: 21,
                        spin: action === "spin",
                        big: action === "oversize",
                      });
      return mark(Response.json(result), env);
    } catch {
      return mark(
        Response.json(
          { error: "proof_operation_interrupted" },
          { status: 502 },
        ),
        env,
      );
    }
  },
};
