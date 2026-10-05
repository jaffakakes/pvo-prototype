import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";

const bundle = buildSync({
  stdin: {
    contents: `export { createAssistantRequestWorkflow } from "./editor/src/features/assistant/assistantRequestWorkflow.ts";
      export { prepareNativeBatch } from "./editor/src/domain/assistant/native/batch.ts";`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
});
const { createAssistantRequestWorkflow, prepareNativeBatch } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const done = { message: "Finished", operations: [], observations: [] };
const edit = {
  message: "Make the project square",
  operations: [{ kind: "project.ratio", ratio: "1:1" }],
  observations: [],
};

function fixture(responses = [edit, done]) {
  let localId = "project-one";
  let scope = 0;
  let project = {
    currentSceneId: "main",
    ratio: "9:16",
    coverAt: 0,
    allowedDomains: [],
    scenes: [
      {
        id: "main",
        name: "Main",
        parent: null,
        muted: false,
        sound: -1,
        clips: [],
        texts: [],
        components: [],
        audioClips: [],
      },
    ],
  };
  const events = [];
  const applications = [];
  const traces = [];
  let exchange = 0;
  const adapters = {
    requestScope: () => scope,
    capture: () => ({
      localId,
      project,
      selection: {
        clipId: null,
        textId: null,
        componentId: null,
        audioId: null,
      },
    }),
    availability: async () => ({
      available: true,
      capabilities: { editing: true },
    }),
    advancedEditingEnabled: () => false,
    createTrace: () => (event) => traces.push(event),
    apply: (batch) => {
      assert.deepEqual(
        batch.before,
        project,
        "Only the unchanged live project receives the complete batch",
      );
      applications.push(batch);
      project = batch.project;
      return { localId, past: [], future: [], fingerprint: "applied-receipt" };
    },
    task: {
      playhead: () => 0,
      turn: async () => {
        const response = responses.shift();
        assert(response, "A model turn needs an explicit result");
        return typeof response === "function" ? response() : response;
      },
      observe: async (_project, request) => ({
        kind: "unavailable",
        sceneId: request.sceneId,
        requestedKind: request.kind,
        message: "No media",
      }),
      prepare: (before, operations, signal) =>
        prepareNativeBatch(before, operations, {
          signal,
          createId: () => 100,
          advancedEditingEnabled: false,
          compile: async () => {
            throw new Error("Ratio-only edits must not compile components");
          },
        }),
    },
    feedback: (prompt) => {
      const id = ++exchange;
      events.push({ id, kind: "started", prompt });
      return {
        working: () => events.push({ id, kind: "working" }),
        progress: (label) => events.push({ id, kind: "progress", label }),
        completed: (result) => events.push({ id, kind: "completed", result }),
        failed: (error) => events.push({ id, kind: "failed", error }),
        cancelled: () => events.push({ id, kind: "cancelled" }),
      };
    },
  };
  const workflow = createAssistantRequestWorkflow(adapters);
  return {
    workflow,
    adapters,
    events,
    applications,
    traces,
    submit: (prompt) =>
      workflow.submit({
        prompt: prompt ?? "Make it square",
        history: [],
        evidence: [],
      }),
    changeProject: () => {
      project = { ...project, ratio: "16:9" };
    },
    replaceProject: () => {
      localId = "project-two";
    },
    changeAccount: () => {
      scope++;
    },
  };
}

test("a project request validates privately and applies the completed batch once", async () => {
  const f = fixture();
  await f.submit("  Make it square  ");
  assert.equal(f.applications.length, 1);
  assert.equal(f.applications[0].project.ratio, "1:1");
  const completion = f.events.find((event) => event.kind === "completed");
  assert.equal(completion.result.answer.request, "Make it square");
  assert.equal(completion.result.answer.message, "Finished");
  assert.equal(completion.result.applied.fingerprint, "applied-receipt");
  assert.deepEqual(
    f.traces
      .filter((event) => event.stage === "application")
      .map((event) => event.status),
    ["started", "completed"],
  );
});

test("account changes reject late answers even after returning to the same account", async () => {
  const response = deferred();
  const entered = deferred();
  const f = fixture([
    () => {
      entered.resolve();
      return response.promise;
    },
  ]);
  const pending = f.submit("Private request");
  await entered.promise;
  f.changeAccount();
  f.changeAccount();
  response.resolve(edit);
  await pending;
  assert.equal(f.applications.length, 0);
  assert.equal(
    f.events.filter((event) => ["completed", "failed"].includes(event.kind))
      .length,
    0,
  );
});

test("an old account's availability failure cannot repopulate the new account's composer", async () => {
  const availability = deferred();
  const f = fixture();
  f.adapters.availability = async () => {
    await availability.promise;
    throw new Error("Old account is unavailable");
  };
  const pending = f.submit("Private request");
  f.changeAccount();
  availability.resolve();
  await pending;
  assert.deepEqual(
    f.events.map((event) => event.kind),
    ["started"],
  );
});

test("late availability from a cancelled request cannot disturb its replacement", async () => {
  const availability = deferred();
  const replacementTurn = deferred();
  const f = fixture([() => replacementTurn.promise]);
  let reads = 0;
  f.adapters.availability = () =>
    ++reads === 1
      ? availability.promise
      : Promise.resolve({ available: true, capabilities: { editing: true } });
  const first = f.submit("First");
  f.workflow.cancel();
  const second = f.submit("Second");
  availability.resolve({ available: true, capabilities: { editing: true } });
  await first;
  await f.submit("Must not replace the active second request");
  replacementTurn.resolve(done);
  await second;
  assert.deepEqual(
    f.events
      .filter((event) => event.kind === "started")
      .map((event) => event.prompt),
    ["First", "Second"],
  );
  assert.deepEqual(
    f.events.filter((event) => event.id === 1).map((event) => event.kind),
    ["started", "cancelled"],
  );
  assert.equal(
    f.events.filter((event) => event.kind === "completed").length,
    1,
  );
});

for (const change of ["changeProject", "replaceProject"]) {
  test(`a late model response cannot apply after ${change}`, async () => {
    const model = deferred();
    const entered = deferred();
    const f = fixture([
      edit,
      () => {
        entered.resolve();
        return model.promise;
      },
    ]);
    const request = f.submit();
    await entered.promise;
    f[change]();
    model.resolve(done);
    await request;
    assert.equal(f.applications.length, 0);
    assert.match(
      f.events.find((event) => event.kind === "failed").error.message,
      /project changed/,
    );
    assert.equal(
      f.events.some((event) => event.kind === "completed"),
      false,
    );
  });
}

test("cancelling during final verification discards prepared edits without reporting failure", async () => {
  const model = deferred();
  const entered = deferred();
  const f = fixture([
    edit,
    () => {
      entered.resolve();
      return model.promise;
    },
  ]);
  const request = f.submit();
  await entered.promise;
  f.workflow.cancel();
  f.workflow.cancel();
  model.resolve(done);
  await request;
  assert.equal(f.applications.length, 0);
  assert.equal(
    f.events.filter((event) => event.kind === "cancelled").length,
    1,
  );
  assert.equal(
    f.events.some((event) => ["failed", "completed"].includes(event.kind)),
    false,
  );
});

test("media inspection completion is rejected when its project is no longer current", async () => {
  const media = deferred();
  const entered = deferred();
  const f = fixture([
    {
      message: "Inspect",
      operations: [],
      observations: [{ kind: "transcript", sceneId: "main", start: 0, end: 1 }],
    },
  ]);
  f.adapters.task.observe = () => {
    entered.resolve();
    return media.promise;
  };
  const request = f.submit();
  await entered.promise;
  f.changeProject();
  media.resolve({
    kind: "unavailable",
    sceneId: "main",
    requestedKind: "transcript",
    message: "No audio",
  });
  await request;
  assert.equal(f.applications.length, 0);
  assert.match(
    f.events.find((event) => event.kind === "failed").error.message,
    /project changed/,
  );
});

test("font and compilation preparation cannot publish a batch after a project edit", async () => {
  const prepared = deferred();
  const entered = deferred();
  const f = fixture();
  const prepare = f.adapters.task.prepare;
  f.adapters.task.prepare = async (...args) => {
    const batch = await prepare(...args);
    entered.resolve();
    await prepared.promise;
    return batch;
  };
  const request = f.submit();
  await entered.promise;
  f.changeProject();
  prepared.resolve();
  await request;
  assert.equal(f.applications.length, 0);
  assert.match(
    f.events.find((event) => event.kind === "failed").error.message,
    /project changed/,
  );
  assert.equal(
    f.events.some((event) => event.kind === "completed"),
    false,
  );
});

test("unavailable service and failed application each produce one request failure", async () => {
  const unavailable = fixture();
  unavailable.adapters.availability = async () => {
    throw new Error("network");
  };
  await unavailable.submit();
  assert.equal(
    unavailable.events.find((event) => event.kind === "failed").error.status,
    503,
  );
  assert.equal(
    unavailable.events.some((event) => event.kind === "working"),
    false,
  );
  const failed = fixture();
  failed.adapters.apply = () => {
    throw new Error("Atomic application refused");
  };
  await failed.submit();
  assert.equal(
    failed.events.filter((event) => event.kind === "failed").length,
    1,
  );
  assert.equal(
    failed.events.some((event) => event.kind === "completed"),
    false,
  );
  assert.deepEqual(
    failed.traces
      .filter((event) => event.stage === "application")
      .map((event) => event.status),
    ["started", "failed"],
  );
});

test("cloud handoff saves the original request once and never applies native history", async () => {
  const proposal = {
    examples: [
      {
        id: "accepted",
        input: "Friend accepts",
        expected: "Save their acceptance",
      },
    ],
  };
  const f = fixture([
    {
      message: "Planning",
      operations: [],
      observations: [],
      cloudTask: proposal,
    },
  ]);
  const saved = [];
  f.adapters.saveTask = async (input, signal, guard) => {
    guard();
    signal.throwIfAborted();
    saved.push(input);
    return { id: "saved-task" };
  };
  await f.submit("Create an invitation with saved replies");
  assert.equal(f.applications.length, 0);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].request, "Create an invitation with saved replies");
  assert.deepEqual(saved[0].proposal, proposal);
  assert.equal(f.events.at(-1).result.savedTaskId, "saved-task");
});

test("a cloud proposal after prepared native edits discards the batch without a server create", async () => {
  const f = fixture([
    edit,
    {
      message: "Planning",
      operations: [],
      observations: [],
      cloudTask: { examples: [{ id: "a", input: "x", expected: "y" }] },
    },
  ]);
  let creates = 0;
  f.adapters.saveTask = async () => {
    creates++;
    return { id: "wrong" };
  };
  await f.submit();
  assert.equal(creates, 0);
  assert.equal(f.applications.length, 0);
  assert.equal(f.events.at(-1).kind, "failed");
});
