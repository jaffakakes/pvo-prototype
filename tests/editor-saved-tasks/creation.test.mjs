import assert from "node:assert/strict";
import test from "node:test";
import { createTask } from "../../packages/pvo-assistant/tasks/index.js";
import { api, proposal, project, deferred } from "./helpers.mjs";

function fixture() {
  let scope = { localId: "draft", ownerId: "owner", epoch: 0, links: null };
  let saved = null;
  let id = 0;
  const requests = [];
  const tasks = new Map();
  const assertCurrent = (value) => {
    assert.equal(value, scope, "scope changed");
  };
  const adapters = {
    begin: () => scope,
    assert: assertCurrent,
    stage(value, input) {
      assertCurrent(value);
      scope = {
        ...scope,
        links: api.stageProjectTask(scope.links, scope.localId, {
          ownerId: scope.ownerId,
          input,
        }),
      };
      return scope;
    },
    finish(value, task) {
      assertCurrent(value);
      scope = {
        ...scope,
        links: api.completeProjectTask(scope.links, scope.ownerId, task),
      };
      return scope;
    },
    fingerprint: () => "saved-fingerprint",
    async flush() {
      saved = structuredClone(scope);
    },
    async resolve() {
      return "project";
    },
    async read() {
      throw new Error("not used");
    },
    async create(input) {
      assert.deepEqual(
        saved.links.pending[0].input,
        input,
        "POST must follow durable pending input",
      );
      requests.push(structuredClone(input));
      if (!tasks.has(input.operationId))
        tasks.set(
          input.operationId,
          createTask(input, {
            id: `task-${tasks.size}`,
            ownerId: scope.ownerId,
            now: Date.now(),
            inputDigest: "a".repeat(64),
          }),
        );
      return tasks.get(input.operationId);
    },
    operationId: () => `create-${++id}`,
  };
  return {
    adapters,
    requests,
    tasks,
    scope: () => scope,
    saved: () => saved,
    change: () => {
      scope = { ...scope, epoch: scope.epoch + 1 };
    },
    reload: () => {
      scope = structuredClone(saved);
    },
    workflow: () => api.createSavedTaskWorkflow(adapters),
  };
}
const start = (workflow) =>
  workflow.start(
    { project: project(), request: "Save friends' acceptances", proposal },
    new AbortController().signal,
    () => {},
  );

test("a lost creation response survives checkpoint/reload and replays the exact submission once", async () => {
  const f = fixture();
  const create = f.adapters.create;
  f.adapters.create = async (input) => {
    await create(input);
    throw new Error("lost response");
  };
  await assert.rejects(start(f.workflow()), /lost response/);
  const pending = f.scope().links;
  const state = {
    ...api.initial(),
    localId: "draft",
    assistantTaskLinks: pending,
  };
  const record = api.storeCheckpoint(
    api.captureCheckpoint(state),
    new Map(),
    Date.now(),
  );
  assert.deepEqual(
    api.restoreCheckpoint(record, new Map()).assistantTaskLinks,
    pending,
  );
  assert.equal(
    api.copyProjectCheckpoint(record, "copy", "Copy", Date.now())
      .assistantTaskLinks,
    undefined,
  );
  f.reload();
  f.adapters.create = create;
  const recovered = await f.workflow().recover(new AbortController().signal);
  assert.equal(f.tasks.size, 1);
  assert.deepEqual(f.requests[0], f.requests[1]);
  assert.deepEqual(f.saved().links.accounts, [
    { ownerId: "owner", projectId: "project", taskId: recovered.id },
  ]);
  assert.equal(f.saved().links.pending, undefined);
});

test("failed pending writes send nothing; failed receipt writes never create a replacement", async () => {
  const f = fixture();
  const flush = f.adapters.flush;
  let count = 0;
  f.adapters.flush = async () => {
    if (++count === 2) throw new Error("disk full");
    return flush();
  };
  await assert.rejects(start(f.workflow()), /disk full/);
  assert.equal(f.requests.length, 0);
  assert.ok(f.scope().links.pending);
  f.adapters.flush = flush;
  await f.workflow().recover(new AbortController().signal);
  assert.equal(f.tasks.size, 1);
  const f2 = fixture();
  const flush2 = f2.adapters.flush;
  let writes = 0;
  f2.adapters.flush = async () => {
    if (++writes === 3) throw new Error("receipt save failed");
    await flush2();
  };
  await assert.rejects(start(f2.workflow()), /receipt save failed/);
  assert.ok(f2.scope().links.accounts.length);
  f2.reload();
  f2.adapters.flush = flush2;
  await f2.workflow().recover(new AbortController().signal);
  assert.equal(f2.tasks.size, 1);
});

test("account/project changes and concurrent submissions cannot attach late receipts or duplicate POSTs", async () => {
  const f = fixture();
  const gate = deferred();
  const create = f.adapters.create;
  f.adapters.create = async (input) => {
    const task = await create(input);
    await gate.promise;
    return task;
  };
  const workflow = f.workflow();
  const request = start(workflow);
  while (!f.requests.length)
    await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(start(workflow), /already in progress/);
  f.change();
  gate.resolve();
  await assert.rejects(request, /scope changed/);
  assert.equal(f.scope().links.accounts.length, 0);
  assert.equal(f.requests.length, 1);
});

test("pending requests cannot be overwritten, reassigned, or completed by an unrelated receipt", () => {
  const input = api.cloudTaskInput(project(), "Build it", proposal, {
    projectId: "project",
    fingerprint: "saved-fingerprint",
    operationId: "create",
  });
  const links = api.stageProjectTask(null, "draft", {
    ownerId: "owner",
    input,
  });
  assert.throws(
    () => api.stageProjectTask(links, "draft", { ownerId: "owner", input }),
    /Recover/,
  );
  const task = createTask(
    { ...input, request: "Different request" },
    {
      id: "task",
      ownerId: "owner",
      now: Date.now(),
      inputDigest: "b".repeat(64),
    },
  );
  assert.throws(
    () => api.completeProjectTask(links, "owner", task),
    /conflicts/,
  );
  assert.throws(
    () =>
      api.parseTaskProjectLinks(
        { ...links, pending: [...links.pending, ...links.pending] },
        "draft",
      ),
    /one pending/,
  );
  const foreign = api.stageProjectTask(links, "draft", {
    ownerId: "other",
    input,
  });
  const valid = createTask(input, {
    id: "task",
    ownerId: "owner",
    now: Date.now(),
    inputDigest: "b".repeat(64),
  });
  assert.deepEqual(api.completeProjectTask(foreign, "owner", valid).pending, [
    { ownerId: "other", input },
  ]);
});

test("immediate recovery remount waits for the aborted save and starts only one POST", async () => {
  const f = fixture();
  const workflow = f.workflow();
  const create = f.adapters.create;
  f.adapters.create = async (input) => {
    await create(input);
    throw new Error("lost response");
  };
  await assert.rejects(start(workflow), /lost response/);
  f.reload();
  f.adapters.create = create;
  const gate = deferred();
  const flush = f.adapters.flush;
  let calls = 0;
  f.adapters.flush = async () => {
    if (++calls === 1) await gate.promise;
    await flush();
  };
  const first = new AbortController();
  const abandoned = workflow.recover(first.signal);
  first.abort();
  const replacement = workflow.recover(new AbortController().signal);
  gate.resolve();
  await assert.rejects(abandoned, (error) => error.name === "AbortError");
  const task = await replacement;
  assert.equal(f.tasks.size, 1);
  assert.equal(
    f.requests.length,
    2,
    "Only the original creation and one recovery reached the server",
  );
  assert.equal(f.saved().links.accounts[0].taskId, task.id);
});
