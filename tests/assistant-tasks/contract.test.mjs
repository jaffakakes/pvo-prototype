import assert from "node:assert/strict";
import test from "node:test";
import {
  createTask,
  parseTaskInput,
  parseTaskRecord,
  replayTaskCreation,
  TASK_LIMITS,
} from "../../packages/pvo-assistant/tasks/index.js";
import {
  create,
  input,
  hash,
  now,
  ownerId,
  claim,
  command,
  question,
  answer,
} from "./fixtures.mjs";

test("creation takes identity from trusted metadata and returns detached exact source", () => {
  const request = input();
  request.context.components[0].source.style = "  color: red;\n";
  const task = createTask(request, {
    id: "task",
    ownerId,
    now,
    inputDigest: hash,
  });
  request.context.components[0].source.style = "changed";
  assert.equal(
    task.input.context.components[0].source.style,
    "  color: red;\n",
  );
  assert.equal(task.state, "queued");
  assert.equal(task.ownerId, ownerId);
  assert.equal(task.deadlineAt, now + TASK_LIMITS.lifetimeMs);
  const copy = parseTaskRecord(task);
  copy.input.examples[0].expected = "different";
  assert.notDeepEqual(copy, task);
});

test("closed input and nested records reject owner injection and credential-bearing additions without echoing them", () => {
  for (const mutate of [
    (value) => {
      value.ownerId = "someone-else";
    },
    (value) => {
      value.context.credentials = { apiKey: "private-token" };
    },
    (value) => {
      value.context.components[0].source.authorization = "private-token";
    },
    (value) => {
      value.examples[0].headers = { Authorization: "private-token" };
    },
  ]) {
    const value = input();
    mutate(value);
    assert.throws(
      () => parseTaskInput(value),
      (error) =>
        !error.message.includes("private-token") &&
        /unsupported fields/.test(error.message),
    );
  }
  assert.throws(() => parseTaskInput({ ...input(), projectId: 1 }), /text/);
  assert.throws(
    () =>
      parseTaskInput({ ...input(), projectId: "https://example.com/project" }),
    /identifier/,
  );
});

test("saved component preparation has bounded real scene identities/timing and explicit source visibility", () => {
  assert.deepEqual(parseTaskInput(input()).context.scenes, [
    { id: "scene-one", name: "Main", duration: 10 },
  ]);
  for (const mutate of [
    (value) => {
      delete value.context.scenes;
    },
    (value) => {
      value.context.currentSceneId = "missing";
    },
    (value) => {
      value.context.scenes.push(value.context.scenes[0]);
    },
    (value) => {
      value.context.scenes[0].duration = Infinity;
    },
    (value) => {
      value.context.scenes[0].duration = -1;
    },
    (value) => {
      value.context.scenes[0].duration = 86401;
    },
    (value) => {
      value.context.components[0].sceneId = "missing";
    },
    (value) => {
      delete value.context.components[0].sourceVisibility;
    },
    (value) => {
      value.context.components[0].sourceVisibility = "trusted";
    },
    (value) => {
      value.context.scenes = Array.from(
        { length: TASK_LIMITS.scenes + 1 },
        (_, i) => ({ id: `scene-${i}`, name: "Scene", duration: 1 }),
      );
    },
  ]) {
    const value = input();
    mutate(value);
    assert.throws(() => parseTaskInput(value));
  }
  const blank = input();
  blank.context.scenes[0].duration = 0;
  blank.context.components[0].sourceVisibility = "design";
  assert.doesNotThrow(() => parseTaskInput(blank));
});

test("text budgets count UTF-8 bytes and input aggregate limits apply across source sections", () => {
  const value = input();
  value.request = "é".repeat(TASK_LIMITS.requestBytes / 2);
  assert.doesNotThrow(() => parseTaskInput(value));
  value.request += "é";
  assert.throws(() => parseTaskInput(value), /byte limit/);
  const large = input();
  large.context.components = Array.from({ length: 3 }, (_, index) => ({
    id: `component-${index}`,
    sceneId: "scene-one",
    type: "form",
    sourceVisibility: "full",
    source: {
      structure: "s".repeat(20_000),
      style: "s".repeat(20_000),
      logic: "s".repeat(20_000),
    },
  }));
  assert.throws(() => parseTaskInput(large), /total byte limit/);
});

test("record aggregates, duplicate IDs, non-JSON values and inconsistent state are rejected", () => {
  const duplicate = input();
  duplicate.examples.push(duplicate.examples[0]);
  assert.throws(() => parseTaskInput(duplicate), /unique/);
  const hole = input();
  hole.examples = new Array(1);
  assert.throws(() => parseTaskInput(hole), /JSON array|JSON values/);
  const accessor = input();
  Object.defineProperty(accessor, "request", {
    enumerable: true,
    get() {
      throw new Error("getter invoked");
    },
  });
  assert.throws(() => parseTaskInput(accessor), /JSON values/);
  for (const mutate of [
    (task) => {
      delete task.ownerId;
    },
    (task) => {
      task.revision = NaN;
    },
    (task) => {
      task.state = "ready";
    },
    (task) => {
      task.expiresAt = task.createdAt;
    },
    (task) => {
      task.generation = task.revision + 1;
    },
    (task) => {
      task.input.context.components[0].source.style = { secret: "x" };
    },
    (task) => {
      task.failure = {
        code: "execution_failed",
        stepId: "plan",
        message: "private-token",
      };
    },
  ]) {
    const task = create();
    mutate(task);
    assert.throws(() => parseTaskRecord(task));
  }
  const task = create();
  task.questions = Array.from({ length: 16 }, (_, index) => ({
    id: `q-${index}`,
    revision: 1,
    prompt: "\u0001".repeat(2000),
    choices: [],
    answer: {
      operationId: `a-${index}`,
      value: "\u0001".repeat(4000),
      answeredAt: now,
    },
  }));
  assert.throws(() => parseTaskRecord(task), /total byte limit/);
});

test("duplicate creation compares the actual validated input as well as its supplied digest", () => {
  const task = create();
  const request = input();
  request.context.components[0].source = {
    logic: "",
    style: "",
    structure: "form",
  };
  assert.deepEqual(
    replayTaskCreation(task, request, { ownerId, inputDigest: hash }),
    task,
  );
  request.request = "Reserve a different restaurant";
  assert.throws(
    () => replayTaskCreation(task, request, { ownerId, inputDigest: hash }),
    /conflicts/,
  );
  assert.throws(
    () =>
      replayTaskCreation(task, input(), {
        ownerId: "other",
        inputDigest: hash,
      }),
    /access denied/,
  );
});

test("question counts and references remain bounded after repeated valid answers", () => {
  let task = create();
  for (let index = 0; index < TASK_LIMITS.questions; index++) {
    task = claim(task);
    task = command(task, {
      kind: "ask",
      question: { ...question(), id: `q-${index}` },
    });
    task = command(task, {
      ...answer(),
      questionId: `q-${index}`,
      operationId: `answer-${index}`,
    });
  }
  task = claim(task);
  assert.throws(
    () => command(task, { kind: "ask", question: question() }),
    /item limit/,
  );
});
