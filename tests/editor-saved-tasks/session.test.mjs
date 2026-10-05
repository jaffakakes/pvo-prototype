import assert from "node:assert/strict";
import test from "node:test";
import {
  createTask,
  transitionTask,
} from "../../packages/pvo-assistant/tasks/index.js";
import { api, proposal, project, deferred } from "./helpers.mjs";

function fixture() {
  const now = Date.now();
  let task = createTask(
    api.cloudTaskInput(project(), "Build it", proposal, {
      projectId: "project",
      fingerprint: "saved-fingerprint",
      operationId: "create",
    }),
    { id: "task", ownerId: "owner", now, inputDigest: "a".repeat(64) },
  );
  const step = (command) => {
    task = transitionTask(task, command, {
      ownerId: task.ownerId,
      expectedRevision: task.revision,
      now: now + 1,
      claim: task.claim
        ? { id: task.claim.id, generation: task.generation }
        : null,
    });
    return task;
  };
  step({ kind: "claim", claimId: "lease", leaseMs: 60000 });
  step({
    kind: "ask",
    question: {
      id: "date",
      revision: 0,
      prompt: "What day?",
      choices: ["Friday"],
      answer: null,
    },
  });
  let current = true;
  const views = [],
    actions = [];
  let expired = 0;
  const adapters = {
    current: () => current,
    read: async () => structuredClone(task),
    change: async (_task, action) => {
      actions.push(action);
      return step(
        action.kind === "answer" ? { ...action, questionRevision: 0 } : action,
      );
    },
    recover: async () => task,
    publish: (value) => views.push(value),
    expiredSession: () => {
      expired++;
    },
    now: () => now + 1,
    operationId: () => "answer-one",
  };
  const session = api.createSavedTaskSession(
    { ownerId: "owner", projectId: "project", taskId: "task" },
    adapters,
  );
  return {
    session,
    adapters,
    views,
    actions,
    expired: () => expired,
    task: () => task,
    stale: () => {
      current = false;
    },
  };
}

test("saved questions load, a lost answer response is reconciled before retry, and disposal does not Stop", async () => {
  const f = fixture();
  try {
    await f.session.start();
    assert.equal(f.views.at(-1).task.questions[0].prompt, "What day?");
    const change = f.adapters.change;
    f.adapters.change = async (...args) => {
      await change(...args);
      throw new Error("lost response");
    };
    await f.session.answer("date", "Friday");
    assert.ok(f.views.at(-1).error);
    f.adapters.change = change;
    await f.session.answer("date", "Friday");
    assert.equal(f.actions.length, 1);
    assert.equal(f.views.at(-1).task.state, "queued");
    assert.equal(f.views.at(-1).error, null);
  } finally {
    f.session.dispose();
  }
  assert.deepEqual(
    f.actions.map((item) => item.kind),
    ["answer"],
  );
});

test("late reads and commands cannot repopulate a disposed or changed account/project scope", async () => {
  for (const dispose of [false, true]) {
    const f = fixture();
    const gate = deferred();
    f.adapters.read = () => gate.promise;
    const request = f.session.start();
    const count = f.views.length;
    if (dispose) f.session.dispose();
    else f.stale();
    gate.resolve(f.task());
    await request;
    assert.equal(f.views.length, count);
    assert.equal(f.actions.length, 0);
    f.session.dispose();
  }
});

test("401 removes private task details and refreshes the real account boundary", async () => {
  const f = fixture();
  try {
    await f.session.start();
    f.adapters.read = async () => {
      throw new api.SavedTaskHttpError(401);
    };
    await f.session.retry();
    assert.equal(f.views.at(-1).task, null);
    assert.equal(f.views.at(-1).signedOut, true);
    assert.equal(f.expired(), 1);
    await f.session.stop();
    assert.equal(f.actions.length, 0);
  } finally {
    f.session.dispose();
  }
});

test("a question answered elsewhere is displayed and never overwritten; Stop uses the latest revision", async () => {
  const f = fixture();
  try {
    await f.session.start();
    await f.adapters.change(f.task(), {
      kind: "answer",
      questionId: "date",
      value: "Saturday",
      operationId: "other-tab",
    });
    await f.session.answer("date", "Friday");
    assert.equal(f.actions.length, 1);
    assert.match(f.views.at(-1).error, /changed/);
    assert.equal(f.views.at(-1).task.questions[0].answer.value, "Saturday");
    await f.session.stop();
    assert.equal(f.views.at(-1).task.state, "stopped");
    await f.session.stop();
    assert.equal(f.actions.length, 2);
  } finally {
    f.session.dispose();
  }
});

test("expiry clears stale question content and permits explicit pending-request cleanup", async () => {
  const f = fixture();
  try {
    await f.session.start();
    f.adapters.read = async () => {
      throw new api.SavedTaskHttpError(410);
    };
    await f.session.retry();
    assert.equal(f.views.at(-1).task, null);
    assert.equal(f.views.at(-1).expired, true);
    const task = f.task();
    const links = api.stageProjectTask(null, "draft", {
      ownerId: task.ownerId,
      input: task.input,
    });
    assert.throws(
      () => api.discardPendingProjectTask(links, task.ownerId, "different"),
      /changed/,
    );
    assert.equal(
      api.discardPendingProjectTask(
        links,
        task.ownerId,
        task.input.operationId,
      ),
      null,
    );
  } finally {
    f.session.dispose();
  }
});
