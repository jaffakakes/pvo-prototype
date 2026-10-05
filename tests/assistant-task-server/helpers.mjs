import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { bundleWorkerModules } from "../worker-bundle.helpers.mjs";
import { createAccountSession } from "../../server/auth/sessions.js";
import { input } from "../assistant-tasks/fixtures.mjs";

export const ORIGIN = "https://tasks.example";
export const NOW = Date.UTC(2100, 0, 1);
const SECRET = "test-saved-task-session-secret-not-for-production";
let modules;

export async function taskFixture({
  storage = true,
  broken = false,
  planner = null,
  services = false,
  providerControl = null,
  workspaces = false,
  workspaceControl = null,
  workspaceEffects = async () => Response.json({}),
} = {}) {
  modules ??= bundleWorkerModules({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
    export { TestBudget, TestWorkspace } from './tests/assistant-workspaces/controlled-worker.js';
    import { reconcileTaskWorkspaces } from './server/assistant/tasks/workspaceRunner.js';
    import { ServiceRelease } from "./server/cloud-services/release.js";
    import { reconcileTaskServices } from "./server/assistant/tasks/providerRunner.js";
    export class TestServiceRelease extends ServiceRelease {
      constructor(ctx, env) { super(ctx, env); ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS calls (id INTEGER PRIMARY KEY CHECK (id=1), count INTEGER NOT NULL)"); }
      now() { return Date.UTC(2100, 0, 1); }
      async publish(value) { this.ctx.storage.sql.exec("INSERT INTO calls (id,count) VALUES (1,1) ON CONFLICT(id) DO UPDATE SET count=count+1"); return super.publish(value); }
      stats() { return { calls: this.ctx.storage.sql.exec("SELECT count FROM calls").toArray()[0]?.count ?? 0, sourcePresent: !!this.row()?.source }; }
    }
    import { savedTaskPlanningAvailable } from "./server/assistant/tasks/availability.js";
    import { handleRequest } from "./server/index.js";
    export { AssistantBudget } from "./server/assistant/budget.js";
    import { AssistantTasks } from "./server/assistant/tasks/coordinator.js";
    import { getAccountSession } from "./server/auth/sessions.js";
    import { HttpError, json } from "./server/http.js";
    export class TestTasks extends AssistantTasks {
      now() { return this.clock ?? (this.env.CONTROLLED_PLAN ? Date.now() : Date.UTC(2100, 0, 1)); }
      plannerAvailable() { return this.env.CONTROLLED_PLAN ? true : super.plannerAvailable(); }
      stepTimeoutMs() { return this.env.CONTROLLED_PLAN ? 1000 : super.stepTimeoutMs(); }
      leaseMs() { return this.env.CONTROLLED_PLAN ? 1500 : super.leaseMs(); }
      async plan(task, signal, input) {
        if (!this.env.CONTROLLED_PLAN) return super.plan(task, signal, input);
        return (await this.env.PLANNER.fetch("https://planner.test/", { method: "POST", body: JSON.stringify({ ...task, builderContext: input?.build ?? null }), signal })).json();
      }
      providerTimeoutMs() { return 500; }
      serviceProvider() {
        if (this.providerDisabled) return null;
        const provider = super.serviceProvider();
        if (!provider || !this.env.PROVIDER_CONTROL) return provider;
        const call = async (action, value) => {
          const identity = value.identity ?? value;
          const control = async phase => {
            const response = await this.env.PROVIDER_CONTROL.fetch("https://provider-control.test", { method: "POST", body: JSON.stringify({ phase, action, identity }) });
            const decision = await response.json();
            if (decision.fail) throw new Error("Controlled provider failure");
          };
          await control("before");
          const result = await provider[action](value);
          await control("after");
          return result;
        };
        return { publish: value => call("publish", value), lookup: value => call("lookup", value), cancel: value => call("cancel", value) };
      }
      workspaceTimeoutMs() { return 500; }
      workspaceProvider() {
        if (this.workspacesDisabled) return null;
        const provider = super.workspaceProvider();
        if (!provider) return null;
        const call = async (action, ...args) => {
          const control = async phase => {
            if (!this.env.WORKSPACE_CONTROL) return;
            const decision = await (await this.env.WORKSPACE_CONTROL.fetch("https://workspace-control.test", {
              method: "POST", body: JSON.stringify({ phase, action, identity: args[0], request: args[2] }) })).json();
            if (decision.fail) throw new Error("Controlled workspace RPC failure");
          };
          await control("before");
          await this.env.ASSISTANT_WORKSPACES.getByName(args[0].resourceId).setTime(this.now());
          await this.env.WORKSPACE_BUDGET.getByName("global").setTime(this.now());
          const result = await provider[action](...args);
          await control("after");
          return result;
        };
        return Object.fromEntries(["operate", "receipt", "lookup", "suspend", "stop"].map(action => [action, (...args) => call(action, ...args)]));
      }
      builderState(id) { return this.builders.get(id); }
      disableWorkspaces() { this.workspacesDisabled = true; }
      async reconcileWorkspaces() { await reconcileTaskWorkspaces(this); return this.workspaceRows(); }
      workspaceRows() { return { operations: this.workspaces.entries(), links: this.workspaces.links() }; }
      async workspaceStatus(identity) {
        const stub = this.env.ASSISTANT_WORKSPACES.getByName(identity.resourceId);
        await stub.setTime(this.now());
        return { observation: await stub.lookup(identity), stats: await stub.inspect() };
      }
      disableProvider() { this.providerDisabled = true; }
      async reconcileProviders() { await this.transaction(() => this.providers.noteTerminal(this.now())); await reconcileTaskServices(this); return this.providers.entries(); }
      providerRows() { return this.providers.entries(); }
      async providerStatus(identity) { const stub=this.env.SERVICE_RELEASES.getByName(identity.resourceId); return { observation: await stub.lookup(identity), stats: await stub.stats() }; }
      async providerProbe(identity, input) { return this.env.SERVICE_RELEASES.getByName(identity.resourceId).probe(identity, input); }
      setTime(now) { this.clock = now; }
      async inspect() { return { alarm: await this.ctx.storage.getAlarm(), records: this.repository.records(),
        identities: this.ctx.storage.sql.exec("SELECT COUNT(*) AS count FROM tasks").one().count }; }
      async step(ownerId, id, command, expectedRevision) {
        return this.ctx.storage.transaction(async () => {
          this.repository.bindOwner(ownerId);
          const task = this.repository.read(id, this.now());
          const next = this.repository.update(id, command, { ownerId,
            expectedRevision: expectedRevision ?? task.revision, now: this.now(),
            claim: ["claim", "recover", "reconcile_operation"].includes(command.kind) ? null
              : task.claim ? { id: task.claim.id, generation: task.generation } : null });
          await this.scheduleMaintenance(this.now());
          return next;
        });
      }
      failResultWrite() { this.ctx.storage.sql.exec("CREATE TRIGGER reject_result BEFORE INSERT ON task_results BEGIN SELECT RAISE(ABORT, 'storage failure'); END;"); }
      resultCount() { return this.ctx.storage.sql.exec("SELECT COUNT(*) AS count FROM task_results").one().count; }
      async sweep() { await this.alarm(); return this.inspect(); }
    }
    export default { async fetch(request, env) {
      // Test-only controls never enter the production entry point.
      if (new URL(request.url).pathname === "/__capability") return json({ available: await savedTaskPlanningAvailable(request,
        { ...env, AI: { run() {} }, ASSISTANT_BUDGET: {}, ...(new URL(request.url).search ? { ASSISTANT_TASKS: undefined } : {}) }, { origin: env.PUBLIC_ORIGIN }) });
      if (new URL(request.url).pathname === "/__test") {
        const owner = await getAccountSession(request, env);
        if (!owner) return new Response(null, { status: 401 });
        const { action, ...args } = await request.json();
        const stub = env.ASSISTANT_TASKS.getByName("owner:" + owner.id);
        try {
          if (action === "builder-state") return json(await stub.builderState(args.id));
          if (action === "workspace-tools") return json(await stub.workspaceToolDefinitions());
          if (action === "workspace-tool") return json(await stub.workspaceTool(owner.id, args.id, args.tool, args.operationId, args.guard));
          if (action === "workspace") return json(await stub.workspaceOperation(owner.id, args.id, args.kind, args.request, args.guard));
          if (action === "workspace-rows") return json(await stub.workspaceRows());
          if (action === "workspace-reconcile") return json(await stub.reconcileWorkspaces());
          if (action === "workspace-status") return json(await stub.workspaceStatus(args.identity));
          if (action === "disable-workspaces") { await stub.disableWorkspaces(); return json({ ok: true }); }
          if (action === "disable-provider") { await stub.disableProvider(); return json({ ok: true }); }
          if (action === "publish") return json(await stub.publishService(owner.id, args.id, args.source, args.guard));
          if (action === "provider-reconcile") return json(await stub.reconcileProviders());
          if (action === "provider-rows") return json(await stub.providerRows());
          if (action === "provider-status") return json(await stub.providerStatus(args.identity));
          if (action === "provider-probe") return json(await stub.providerProbe(args.identity, args.input));
          if (action === "time") { await stub.setTime(args.now); return json({ ok: true }); }
          if (action === "inspect") return json(await stub.inspect());
          if (action === "sweep") return json(await stub.sweep());
          if (action === "fail-result-write") { await stub.failResultWrite(); return json({ ok: true }); }
          if (action === "results") return json({ count: await stub.resultCount() });
          if (action === "complete") return json(await stub.completePreparedResult(owner.id, args.id, args.operations, args.guard));
          if (action === "step") return json(await stub.step(owner.id, args.id, args.command, args.expectedRevision));
          return new Response(null, { status: 404 });
        } catch { return json({ error: "Test step conflict" }, 409); }
      }
      if (env.BROKEN) env = { ...env, ASSISTANT_TASKS: { getByName() { throw new Error("offline"); } } };
      return handleRequest(request, env);
    } };
  `,
    },
  });
  const persist = await mkdtemp(join(tmpdir(), "restyle-task-storage-"));
  const bundledModules = await modules;
  const options = () =>
    convertV4MiniflareOptions({
      name: "saved-tasks-test",
      modules: bundledModules,
      compatibilityDate: "2026-09-27",
      d1Databases: ["DB"],
      bindings: {
        PUBLIC_ORIGIN: ORIGIN,
        SESSION_SECRET: SECRET,
        BROKEN: broken,
        CONTROLLED_PLAN: Boolean(planner),
      },
      ...(planner || providerControl || workspaces
        ? {
            serviceBindings: {
              ...(planner ? { PLANNER: planner } : {}),
              ...(workspaces ? { CONTROL: workspaceEffects } : {}),
              ...(workspaceControl
                ? { WORKSPACE_CONTROL: workspaceControl }
                : {}),
              ...(providerControl ? { PROVIDER_CONTROL: providerControl } : {}),
            },
          }
        : {}),
      ...(services ? { workerLoaders: { SERVICE_LOADER: {} } } : {}),
      ...(storage
        ? {
            durableObjects: {
              ASSISTANT_TASKS: { className: "TestTasks", useSQLite: true },
              ...(workspaces
                ? {
                    ASSISTANT_WORKSPACES: {
                      className: "TestWorkspace",
                      useSQLite: true,
                    },
                    WORKSPACE_BUDGET: {
                      className: "TestBudget",
                      useSQLite: true,
                    },
                  }
                : {}),
              ...(services
                ? {
                    SERVICE_RELEASES: {
                      className: "TestServiceRelease",
                      useSQLite: true,
                    },
                  }
                : {}),
              ...(planner
                ? {
                    ASSISTANT_BUDGET: {
                      className: "AssistantBudget",
                      useSQLite: true,
                    },
                  }
                : {}),
            },
          }
        : {}),
      isolatedResourcePersistencePath: persist,
      resourcePersistencePath: persist,
    });
  let mf;
  let cookie;
  let otherCookie;
  const start = async () => {
    mf = new Miniflare(options());
    await mf.ready;
  };
  try {
    await start();
    const db = await mf.getD1Database("DB");
    for (const name of (await readdir("migrations"))
      .filter((name) => name.endsWith(".sql"))
      .sort()) {
      const statements = (await readFile(`migrations/${name}`, "utf8"))
        .split(";")
        .map((sql) => sql.trim())
        .filter(Boolean);
      await db.batch(statements.map((sql) => db.prepare(sql)));
    }
    cookie = (
      await createAccountSession(
        { sub: "task-owner-one", name: "First" },
        { DB: db, SESSION_SECRET: SECRET },
      )
    ).split(";", 1)[0];
    otherCookie = (
      await createAccountSession(
        { sub: "task-owner-two", name: "Second" },
        { DB: db, SESSION_SECRET: SECRET },
      )
    ).split(";", 1)[0];
    const request = async (
      path,
      {
        body,
        method = body === undefined ? "GET" : "POST",
        session = cookie,
        headers = {},
        ...rest
      } = {},
    ) => {
      const response = await mf.dispatchFetch(ORIGIN + path, {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        headers: {
          Origin: ORIGIN,
          ...(session ? { Cookie: session } : {}),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...headers,
        },
        ...rest,
      });
      return {
        status: response.status,
        headers: response.headers,
        body: await response.json(),
      };
    };
    return {
      request,
      cookie,
      otherCookie,
      project: (localId = "local-draft", options = {}) =>
        request("/api/assistant/projects", { body: { localId }, ...options }),
      create: (projectId, overrides = {}, options = {}) =>
        request("/api/assistant/tasks", {
          body: { ...input(), projectId, ...overrides },
          ...options,
        }),
      control: (body) => request("/__test", { body }),
      restart: async () => {
        await mf.dispose();
        await start();
      },
      close: async () => {
        try {
          await mf?.dispose();
        } finally {
          await rm(persist, { recursive: true, force: true });
        }
      },
    };
  } catch (error) {
    await mf?.dispose();
    await rm(persist, { recursive: true, force: true });
    throw error;
  }
}

export const path = (task) => `/api/assistant/tasks/${task.id}`;
export const expectStatus = (response, status) =>
  assert.equal(response.status, status, JSON.stringify(response.body));

export async function saved(fixture) {
  const project = await fixture.project();
  expectStatus(project, 200);
  const created = await fixture.create(project.body.project.id);
  expectStatus(created, 201);
  return created.body.task;
}
