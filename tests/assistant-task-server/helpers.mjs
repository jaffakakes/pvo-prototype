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
  origin = ORIGIN,
  clock = null,
  storage = true,
  broken = false,
  planner = null,
  services = false,
  providerControl = null,
  workspaces = false,
  workspaceControl = null,
  workspaceEffects = async () => Response.json({}),
  researchFetch = null,
  validationControl = null,
  hostControl = null,
  draftControl = null,
  spending = true,
} = {}) {
  modules ??= bundleWorkerModules({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
    export { TestBudget, TestWorkspace } from './tests/assistant-workspaces/controlled-worker.js';
    import { installCheckedDiagnostic } from "./scripts/checks/cloud-agent-recovery/checked-fixture.js";
    import { taskResearchTools } from "./server/assistant/builder/researchTools.js";
    import { publicResearch } from "./server/assistant/builder/researchProvider.js";
    import { reconcileTaskWorkspaces } from './server/assistant/tasks/workspaceRunner.js';
    import {prepareServicePublication,serviceIntentDigest} from "./server/cloud-services/releaseContract.js";
    import { resolveTaskAttachment } from "./server/assistant/attachments/receipt.js";
    import { HostedService } from "./server/cloud-services/host.js";
    import { reconcileTaskServices } from "./server/assistant/tasks/providerRunner.js";
    export class TestHostedService extends HostedService {
      constructor(ctx, env) { super(ctx, env); ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS calls (id TEXT PRIMARY KEY, count INTEGER NOT NULL)"); }
      now() { return this.clock ?? this.env.CONTROLLED_CLOCK ?? (this.env.CONTROLLED_PLAN ? Date.now() : Date.UTC(2100, 0, 1)); }
      setTime(now) { this.clock=now; }
      async saveTaskDraft(serviceId, ownerId, input, grant) {
        const control = async phase => {
          if (!this.env.DRAFT_CONTROL) return;
          const response = await this.env.DRAFT_CONTROL.fetch("https://draft-control.test", {method:"POST",body:JSON.stringify({phase,input,grant})});
          if ((await response.json()).fail) throw new Error("Controlled draft RPC failure");
        };
        await control("before");
        const result = await super.saveTaskDraft(serviceId,ownerId,input,grant);
        await control("after");
        return result;
      }
      async publish(value) { this.ctx.storage.sql.exec("INSERT INTO calls (id,count) VALUES (?,1) ON CONFLICT(id) DO UPDATE SET count=count+1",value.identity.resourceId); return super.publish(value); }
      async executePackage(source,invocation,signal) {
        if(this.env.HOST_CONTROL) await this.env.HOST_CONTROL.fetch('https://control.test',{method:'POST',body:JSON.stringify({phase:'before',invocation})});
        return super.executePackage(source,invocation,signal);
      }
      diagnostic(action) {
        return {controls:this.ctx.storage.sql.exec('SELECT COUNT(*) AS count FROM service_controls').one().count,service:this.store.service(),data:this.ctx.storage.sql.exec('SELECT namespace,body,version FROM service_data').toArray(),receipts:this.ctx.storage.sql.exec('SELECT namespace,id,body FROM service_actions').toArray(),usage:this.ctx.storage.sql.exec('SELECT * FROM service_usage').toArray()};
      }
      stats(identity) { return { calls: this.ctx.storage.sql.exec("SELECT count FROM calls WHERE id=?",identity.resourceId).toArray()[0]?.count ?? 0, sourcePresent: !!this.store.row(identity.resourceId)?.body }; }
    }
    import { savedTaskPlanningAvailable } from "./server/assistant/tasks/availability.js";
    import { handleRequest } from "./server/index.js";
    import { AssistantBudget } from "./server/assistant/budget.js";
    export class TestAssistantBudget extends AssistantBudget {
      now() { return this.clock ?? this.env.CONTROLLED_CLOCK ?? Date.now(); }
      setTime(now) { this.clock = now; }
    }
    import { taskSpendingAllowed } from "./server/assistant/tasks/spending.js";
    import { AssistantTasks } from "./server/assistant/tasks/coordinator.js";
    import { getAccountSession } from "./server/auth/sessions.js";
    import { HttpError, json } from "./server/http.js";
    export class TestTasks extends AssistantTasks {
      constructor(ctx, env) { super(ctx,env);ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS test_spending (id INTEGER PRIMARY KEY, body TEXT NOT NULL)"); }
      now() { return this.clock ?? this.env.CONTROLLED_CLOCK ?? (this.env.CONTROLLED_PLAN ? Date.now() : Date.UTC(2100, 0, 1)); }
      plannerAvailable() { return this.planningPaused ? false : this.env.CONTROLLED_PLAN ? true : super.plannerAvailable(); }
      spendingAllowed(task, capability) {
        if (this.env.CONTROLLED_SPENDING) return true;
        const encoded = this.ctx.storage.sql.exec("SELECT body FROM test_spending WHERE id=1").toArray()[0]?.body ?? "[]";
        return taskSpendingAllowed({ASSISTANT_TASK_SPENDING:encoded},task.ownerId,capability,this.now());
      }
      grantSpending(ownerId, grants) {
        this.repository.bindOwner(ownerId);
        this.ctx.storage.sql.exec("INSERT INTO test_spending (id,body) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body",JSON.stringify(grants));
      }
      pausePlanning() { this.planningPaused = true; }
      async alarm() { if (!this.planningPaused) return super.alarm(); }
      stepTimeoutMs() { return this.env.CONTROLLED_PLAN ? 1000 : super.stepTimeoutMs(); }
      leaseMs() { return this.env.CONTROLLED_PLAN ? 1500 : super.leaseMs(); }
      async plan(task, signal, input) {
        if (!this.env.CONTROLLED_PLAN) return super.plan(task, signal, input);
        return (await this.env.PLANNER.fetch("https://planner.test/", { method: "POST", body: JSON.stringify({ ...task, draftContext: input?.draft ?? null, builderContext: input?.build ?? null, attachmentContext: input?.attachment ?? null, evidenceContext: input?.evidence ?? null }), signal })).json();
      }
      providerTimeoutMs() { return 500; }
      serviceProvider() {
        if (this.providerDisabled) return null;
        const provider = super.serviceProvider();
        if (!provider) return provider;
        const call = async (action, value) => {
          const identity = value.identity ?? value;
          await this.env.SERVICE_HOSTS.getByName(identity.serviceId).setTime(this.now());
          const control = async phase => {
            if (!this.env.PROVIDER_CONTROL) return;
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
      async publishFixture(ownerId,id,checked,guard) {
        const claimed=await this.claimForOperation(ownerId,id,guard);
        await installCheckedDiagnostic(this,claimed,checked);
        return this.publishService(ownerId,id,guard);
      }
      async preparePublication(ownerId,id,checked,guard) {
        const task=await this.claimForOperation(ownerId,id,guard);
        await installCheckedDiagnostic(this,task,checked);
        const publication=await prepareServicePublication(task,'prepared-'+task.generation,checked,this.now()+86400000);
        const digest=await serviceIntentDigest(publication.identity);
        return this.transaction(()=>this.providers.begin(task,publication,digest,this.now()));
      }
      dispatchPublication(ownerId,id,rowId) {
        this.repository.bindOwner(ownerId);
        return this.transaction(()=>this.providers.dispatch(this.repository.read(id,this.now()),rowId,this.now()));
      }
      // Trusted fixture only: isolate hosted version control from the later update-authoring workflow.
      async publishVersion(ownerId,id,checked,operationId) {
        this.repository.bindOwner(ownerId);
        const task=this.repository.read(id,this.now());
        const publication=await prepareServicePublication(task,operationId,checked,this.now()+86_400_000);
        await this.transaction(()=>this.services.intent(task,publication,this.now()));
        const result=await this.env.SERVICE_HOSTS.getByName(publication.identity.serviceId).publish(publication);
        await this.transaction(()=>this.services.observe(publication.identity,result.state,this.now()));
        return publication.identity;
      }
      async resolveAttachment(ownerId,id,guard,command) { return resolveTaskAttachment(this,await this.claimForOperation(ownerId,id,guard),command); }
      serviceCatalog() { return this.services.services().map(service=>({service,releases:this.services.releases(service.identity.serviceId)})); }
      async runValidationStep(artifact, index, cursor, signal) {
        const control = async phase => {
          if (!this.env.VALIDATION_CONTROL) return;
          const decision = await (await this.env.VALIDATION_CONTROL.fetch("https://validation-control.test", {method:"POST", body:JSON.stringify({phase,index,step:cursor.step,identity:artifact.identity})})).json();
          if (decision.fail) throw new Error("Controlled validation interruption");
          if (decision.wait) throw Object.assign(new Error("Controlled capacity"),decision.wait);
        };
        await control("before");
        const result = await super.runValidationStep(artifact,index,cursor,signal);
        await control("after");
        return result;
      }
      validationState(id) { return { attempts: this.validation.entries().filter(row => row.taskId === id), artifacts: this.ctx.storage.sql.exec("SELECT body FROM task_service_artifacts WHERE task_id=? ORDER BY round",id).toArray().map(row => JSON.parse(row.body)) }; }
      researchProvider() { return this.env.RESEARCH ? publicResearch({ fetch: (url, init) => this.env.RESEARCH.fetch(url, init) }) : super.researchProvider(); }
      async researchTool(ownerId, id, tool, operationId, guard) { return taskResearchTools(this, await this.claimForOperation(ownerId,id,guard)).execute(tool,operationId); }
      researchRows() { return this.research.entries(); }
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
      async hostDiagnostic(ownerId,identity,action) {
        this.repository.bindOwner(ownerId);
        if(identity.ownerId!==ownerId) throw new Error('Wrong diagnostic owner');
        const stub=this.env.SERVICE_HOSTS.getByName(identity.serviceId);
        await stub.setTime(this.now());
        return stub.diagnostic(action);
      }
      async providerStatus(identity) { const stub=this.env.SERVICE_HOSTS.getByName(identity.serviceId); return { observation: await stub.lookup(identity), stats: await stub.stats(identity) }; }
      async providerProbe(identity, input) { return this.env.SERVICE_HOSTS.getByName(identity.serviceId).probe(identity, input); }
      setTime(now) { this.clock = now; }
      progressContext(ownerId,id) {
        this.repository.bindOwner(ownerId);
        return this.progress.context(this.repository.read(id,this.now()));
      }
      progressCount() { return this.ctx.storage.sql.exec("SELECT COUNT(*) AS count FROM task_progress").one().count; }
      progressWriteFailure(enabled) {
        if(enabled) this.ctx.storage.sql.exec("CREATE TRIGGER reject_progress BEFORE INSERT ON task_progress BEGIN SELECT RAISE(ABORT, 'controlled progress failure'); END;");
        else this.ctx.storage.sql.exec("DROP TRIGGER reject_progress;");
      }
      evidenceContext(ownerId,id) {
        this.repository.bindOwner(ownerId);
        return this.evidence.context(this.repository.read(id,this.now()));
      }
      selectEvidence(ownerId,id,request) {
        this.repository.bindOwner(ownerId);
        return this.evidence.select(this.repository.read(id,this.now()),request);
      }
      operationHistory(ownerId,id,after) {
        this.repository.bindOwner(ownerId);this.repository.read(id,this.now());
        return this.repository.history.page(id,after);
      }
      historyWriteFailure(enabled) {
        if(enabled) this.ctx.storage.sql.exec("CREATE TRIGGER reject_history BEFORE INSERT ON task_operation_history BEGIN SELECT RAISE(ABORT, 'controlled archive failure'); END; CREATE TRIGGER reject_questions BEFORE INSERT ON task_question_history BEGIN SELECT RAISE(ABORT, 'controlled question failure'); END;");
        else this.ctx.storage.sql.exec("DROP TRIGGER reject_history; DROP TRIGGER reject_questions;");
      }
      repairWriteFailure(enabled) {
        if(enabled) this.ctx.storage.sql.exec("CREATE TRIGGER reject_repairs BEFORE INSERT ON task_repairs BEGIN SELECT RAISE(ABORT, 'controlled repair failure'); END;");
        else this.ctx.storage.sql.exec("DROP TRIGGER reject_repairs;");
      }
      attemptRows() { return this.attempts.entries(); }
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
          if (action === "validation-state") return json(await stub.validationState(args.id));
          if (action === "research-tool") return json(await stub.researchTool(owner.id,args.id,args.tool,args.operationId,args.guard));
          if (action === "research-rows") return json(await stub.researchRows());
          if (action === "builder-state") return json(await stub.builderState(args.id));
          if (action === "workspace-budget") {
            const budget = env.WORKSPACE_BUDGET.getByName("global");
            await budget.setTime(args.now);
            return json(await budget[args.method](args.lease));
          }
          if (action === "workspace-tools") return json(await stub.workspaceToolDefinitions());
          if (action === "workspace-tool") return json(await stub.workspaceTool(owner.id, args.id, args.tool, args.operationId, args.guard));
          if (action === "workspace") return json(await stub.workspaceOperation(owner.id, args.id, args.kind, args.request, args.guard));
          if (action === "workspace-rows") return json(await stub.workspaceRows());
          if (action === "workspace-reconcile") return json(await stub.reconcileWorkspaces());
          if (action === "workspace-status") return json(await stub.workspaceStatus(args.identity));
          if (action === "disable-workspaces") { await stub.disableWorkspaces(); return json({ ok: true }); }
          if (action === "disable-provider") { await stub.disableProvider(); return json({ ok: true }); }
          if (action === "publish") return json(await stub.publishFixture(owner.id, args.id, args.checked, args.guard));
          if (action === "prepare-publication") return json(await stub.preparePublication(owner.id,args.id,args.checked,args.guard));
          if (action === "dispatch-publication") return json(await stub.dispatchPublication(owner.id,args.id,args.rowId));
          if (action === "publish-unchecked") return json(await stub.publishService(owner.id,args.id,args.guard));
          if (action === "attachment") return json(await stub.resolveAttachment(owner.id,args.id,args.guard,args.command));
          if (action === "host-version") return json(await stub.publishVersion(owner.id,args.id,args.checked,args.operationId));
          if (action === "service-catalog") return json(await stub.serviceCatalog());
          if (action === "provider-reconcile") return json(await stub.reconcileProviders());
          if (action === "provider-rows") return json(await stub.providerRows());
          if (action === "host-diagnostic") return json(await stub.hostDiagnostic(owner.id,args.identity,args.kind));
          if (action === "provider-status") return json(await stub.providerStatus(args.identity));
          if (action === "provider-probe") return json(await stub.providerProbe(args.identity, args.input));
          if (action === "grant-spending") { await stub.grantSpending(owner.id,args.grants); return json({ok:true}); }
          if (action === "time") {
            await stub.setTime(args.now);
            if (env.ASSISTANT_BUDGET) await env.ASSISTANT_BUDGET.getByName("assistant:" + new Date(args.now).toISOString().slice(0,10)).setTime(args.now);
            return json({ ok: true });
          }
          if (action === "pause-planning") {await stub.pausePlanning();return json({ok:true});}
          if (action === "progress-context") return json(await stub.progressContext(owner.id,args.id));
          if (action === "progress-count") return json(await stub.progressCount());
          if (action === "progress-write-failure") {await stub.progressWriteFailure(args.enabled);return json({ok:true});}
          if (action === "evidence-context") return json(await stub.evidenceContext(owner.id,args.id));
          if (action === "select-evidence") return json(await stub.selectEvidence(owner.id,args.id,args.request));
          if (action === "operation-history") return json(await stub.operationHistory(owner.id,args.id,args.after));
          if (action === "history-write-failure") {await stub.historyWriteFailure(args.enabled);return json({ok:true});}
          if (action === "repair-write-failure") {await stub.repairWriteFailure(args.enabled);return json({ok:true});}
          if (action === "attempt-rows") return json(await stub.attemptRows());
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
        PUBLIC_ORIGIN: origin,
        SESSION_SECRET: SECRET,
        BROKEN: broken,
        CONTROLLED_PLAN: Boolean(planner),
        CONTROLLED_CLOCK: clock,
        CONTROLLED_SPENDING: spending,
      },
      ...(planner ||
      providerControl ||
      workspaces ||
      researchFetch ||
      validationControl ||
      hostControl ||
      draftControl
        ? {
            serviceBindings: {
              ...(planner ? { PLANNER: planner } : {}),
              ...(validationControl
                ? { VALIDATION_CONTROL: validationControl }
                : {}),
              ...(researchFetch ? { RESEARCH: researchFetch } : {}),
              ...(workspaces ? { CONTROL: workspaceEffects } : {}),
              ...(workspaceControl
                ? { WORKSPACE_CONTROL: workspaceControl }
                : {}),
              ...(providerControl ? { PROVIDER_CONTROL: providerControl } : {}),
              ...(hostControl ? { HOST_CONTROL: hostControl } : {}),
              ...(draftControl ? { DRAFT_CONTROL: draftControl } : {}),
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
                    SERVICE_HOSTS: {
                      className: "TestHostedService",
                      useSQLite: true,
                    },
                  }
                : {}),
              ...(planner
                ? {
                    ASSISTANT_BUDGET: {
                      className: "TestAssistantBudget",
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
      const response = await mf.dispatchFetch(origin + path, {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        headers: {
          Origin: origin,
          ...(session ? { Cookie: session } : {}),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...headers,
        },
        ...rest,
      });
      return {
        status: response.status,
        headers: response.headers,
        body: response.status === 204 ? null : await response.json(),
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
