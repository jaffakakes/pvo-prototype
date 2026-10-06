import { AssistantWorkspace } from "../../../server/assistant/workspaces/coordinator.js";
import { WorkspaceBudget } from "../../../server/assistant/workspaces/budget.js";
import { workspaceResourceId } from "../../../server/assistant/workspaces/identity.js";
import { authorize, mark } from "../cloud-agent-infrastructure/proof-http.js";
import { SUBJECTS, sourceFiles } from "./fixtures.js";

export class WorkspaceProofBudget extends WorkspaceBudget {
  allowProofCall() {
    const sql = this.ctx.storage.sql;
    sql.exec(
      "CREATE TABLE IF NOT EXISTS proof_calls (id INTEGER PRIMARY KEY CHECK(id=1), count INTEGER NOT NULL)",
    );
    return this.ctx.storage.transactionSync(() => {
      const count =
        sql.exec("SELECT count FROM proof_calls WHERE id=1").toArray()[0]
          ?.count ?? 0;
      if (count >= 60) return false;
      sql.exec(
        "INSERT INTO proof_calls (id,count) VALUES (1,1) ON CONFLICT(id) DO UPDATE SET count=count+1",
      );
      return true;
    });
  }
}

/** Fixed diagnostic controls only. This entry point is never deployed as the product. */
export class WorkspaceProof extends AssistantWorkspace {
  rawProvider() {
    return super.provider();
  }
  provider() {
    const provider = this.rawProvider();
    return {
      start: (lease) => provider.start(lease),
      execute: (command) => provider.execute(command),
      absent: () => provider.absent(),
      destroy: () => provider.destroy(),
      restore: async (snapshot, guard) => {
        await provider.restore(snapshot, guard);
        const state = this.journal.state();
        if (
          state.identity.taskId === "recovery" &&
          state.active?.id === "start"
        ) {
          this.ctx.abort(
            "Controlled reset after the real workspace was restored",
          );
        }
      },
    };
  }
  async subjectIdentity(subject) {
    if (!SUBJECTS.includes(subject)) throw new Error("Unknown proof workspace");
    let identity = await this.ctx.storage.get("proof-identity");
    if (!identity) {
      const base = {
        ownerId: `proof-${this.env.PROOF_ID}`,
        projectId: "workspace-proof",
        taskId: subject,
      };
      identity = { ...base, resourceId: await workspaceResourceId(base) };
      await this.ctx.storage.put("proof-identity", identity);
    }
    if (identity.taskId !== subject) throw new Error("Proof subject conflict");
    return identity;
  }
  async grant() {
    return this.ctx.storage.transaction(async () => {
      const generation =
        ((await this.ctx.storage.get("proof-generation")) ?? 0) + 1;
      await this.ctx.storage.put("proof-generation", generation);
      return {
        id: `proof-claim-${generation}`,
        generation,
        expiresAt: Date.now() + 60000,
      };
    });
  }
  async diagnostic(subject, action) {
    const identity = await this.subjectIdentity(subject);
    if (action === "save")
      return this.save(
        identity,
        { id: "save", expectedRevision: 0, files: sourceFiles(subject) },
        await this.grant(),
      );
    if (action === "status")
      return {
        ...(await this.lookup(identity)),
        absent: await this.provider().absent(),
      };
    if (action === "receipt") return this.receipt(identity, "start");
    if (action === "stop") return this.stop(identity);
    const source = (await this.lookup(identity)).source;
    if (!source) throw new Error("Saved proof source is missing");
    const reference = { revision: source.revision, digest: source.digest };
    if (["start", "restart", "late-start"].includes(action))
      return this.start(
        identity,
        { id: action, ...reference },
        await this.grant(),
      );
    if (action === "execute")
      return this.execute(
        identity,
        {
          id: "execute",
          ...reference,
          command: { kind: "test", paths: ["tests/service.test.mjs"] },
        },
        await this.grant(),
      );
    throw new Error("Unknown proof action");
  }
  async disposeProof(subject) {
    const identity = await this.subjectIdentity(subject);
    const stopped = await this.stop(identity);
    if (stopped.cleanupRequired || !(await this.provider().absent()))
      throw new Error("Proof workspace cleanup is unresolved");
    await this.ctx.storage.deleteAll();
    return { absent: true };
  }
}

export default {
  async fetch(request, env) {
    const denied = authorize(request, env);
    if (denied) return mark(denied, env);
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health")
      return mark(Response.json({ ready: true }), env);
    const workspace = async (subject) =>
      env.ASSISTANT_WORKSPACES.getByName(
        await workspaceResourceId({
          ownerId: `proof-${env.PROOF_ID}`,
          projectId: "workspace-proof",
          taskId: subject,
        }),
      );
    if (request.method === "DELETE" && url.pathname === "/") {
      const results = [];
      for (const subject of SUBJECTS)
        results.push(await (await workspace(subject)).disposeProof(subject));
      return mark(Response.json({ results }), env);
    }
    if (!(await env.WORKSPACE_BUDGET.getByName("global").allowProofCall()))
      return mark(
        Response.json({ error: "proof_call_limit" }, { status: 429 }),
        env,
      );
    const [, subject, action] = url.pathname.split("/");
    if (
      !SUBJECTS.includes(subject) ||
      !["GET", "POST"].includes(request.method)
    )
      return mark(new Response(null, { status: 404 }), env);
    try {
      return mark(
        Response.json(
          await (await workspace(subject)).diagnostic(subject, action),
        ),
        env,
      );
    } catch (error) {
      return mark(
        Response.json(
          {
            error: "proof_operation_failed",
            detail: String(error.message).slice(0, 300),
          },
          { status: 409 },
        ),
        env,
      );
    }
  },
};
