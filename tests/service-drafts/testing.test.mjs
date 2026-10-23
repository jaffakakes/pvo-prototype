import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  taskFixture,
  expectStatus,
  path,
} from "../assistant-task-server/helpers.mjs";
import {
  dinnerAgreement,
  packageFor,
} from "../service-validation/fixtures.mjs";
import { deferred } from "../assistant-task-server/workspace.helpers.mjs";
import { create, until } from "./task.helpers.mjs";

const content = () => {
  const { files, entrypoint, tests } = packageFor();
  return { files, entrypoint, tests, agreement: dinnerAgreement() };
};
test(
  "manual checking waits for its workspace/hosting permission without requiring model permission",
  { timeout: 25000 },
  async () => {
    const f = await taskFixture({
      services: true,
      workspaces: true,
      spending: false,
      planner: async () => {
        throw new Error("Model use is not authorized");
      },
      workspaceEffects: async () =>
        Response.json({ exitCode: 0, stdout: "passed" }),
    });
    try {
      const c = await create(f, content(), "test");
      const waiting = await until(f, c.task, (t) => t.state === "waiting");
      assert.equal(waiting.wait.reason, "spending_permission");
      assert.equal(waiting.usage.toolCalls, 0);
      await f.control({
        action: "grant-spending",
        grants: [
          {
            ownerId: c.task.ownerId,
            capabilities: ["workspace", "hosting"],
            expiresAt: Date.now() + 60000,
          },
        ],
      });
      expectStatus(
        await f.request(path(waiting) + "/resume", {
          body: { expectedRevision: waiting.revision },
        }),
        200,
      );
      const finished = await until(f, c.task, (t) =>
        ["ready", "failed"].includes(t.state),
      );
      assert.equal(finished.state, "ready", JSON.stringify(finished));
      assert.equal(finished.usage.modelTurns, 0);
    } finally {
      await f.close();
    }
  },
);
test(
  "manual tests use no model calls, preserve the exact saved draft and recover creation after restart",
  { timeout: 25000 },
  async () => {
    let models = 0;
    const f = await taskFixture({
      services: true,
      workspaces: true,
      planner: async () => {
        models++;
        throw new Error("Manual testing cannot call a model");
      },
      workspaceEffects: async () =>
        Response.json({ exitCode: 0, stdout: "generated tests passed" }),
    });
    try {
      const c = await create(f, content(), "test");
      const task = await until(f, c.task, (t) =>
        ["ready", "failed"].includes(t.state),
      );
      assert.equal(task.state, "ready", JSON.stringify(task));
      assert.equal(task.usage.modelTurns, 0);
      assert.equal(models, 0);
      const tests = await f.request(path(task) + "/tests");
      expectStatus(tests, 200);
      assert.equal(tests.body.tests.report.status, "passed");
      assert.equal(tests.body.tests.revision, 1);
      expectStatus(
        await f.request(path(task) + "/tests", { session: f.otherCookie }),
        404,
      );
      expectStatus(
        await f.request(path(task) + "/tests", { session: null }),
        401,
      );
      assert.deepEqual((await f.request(c.draftPath)).body, c.draft);
      assert.equal((await f.request(path(task) + "/result")).body.revision, 1);
      const summary = (await f.request("/api/services")).body.services[0]
        .summary;
      assert.equal(summary.service.liveReleaseId, null);
      assert.ok(summary.service.testReleaseId);
      await f.restart();
      expectStatus(
        await f.create(c.draft.identity.projectId, c.taskInput),
        200,
      );
      expectStatus(
        await f.create(c.draft.identity.projectId, {
          ...c.taskInput,
          context: {
            ...c.taskInput.context,
            container: { ...c.taskInput.context.container, mode: "edit" },
          },
        }),
        409,
      );
      assert.deepEqual((await f.request(c.draftPath)).body, c.draft);
      const command = {
        kind: "activate",
        actionId: randomUUID(),
        expectedRevision: summary.service.revision,
        releaseId: summary.service.testReleaseId,
      };
      const activate = c.draftPath.replace(/draft$/, "activate");
      const published = await f.request(activate, { body: command });
      expectStatus(published, 200);
      assert.equal(
        published.body.summary.service.liveReleaseId,
        summary.service.testReleaseId,
      );
      await f.restart();
      expectStatus(await f.request(activate, { body: command }), 200);
    } finally {
      await f.close();
    }
  },
);

test(
  "a failed generated test stops manual checking without rewriting code or publishing",
  { timeout: 25000 },
  async () => {
    const f = await taskFixture({
      services: true,
      workspaces: true,
      planner: async () => {
        throw new Error("No AI repair in manual testing");
      },
      workspaceEffects: async () =>
        Response.json({ exitCode: 1, stdout: "Assertion failed" }),
    });
    try {
      const c = await create(f, content(), "test");
      const failed = await until(f, c.task, (t) => t.state === "failed");
      assert.equal(failed.failure.code, "tests_failed");
      assert.equal(failed.stepId, "build");
      const tests = await f.request(path(failed) + "/tests");
      expectStatus(tests, 200);
      assert.equal(tests.body.tests.generated.exitCode, 1);
      assert.equal(tests.body.tests.generated.stdout, "Assertion failed");
      assert.equal(tests.body.tests.report, null);
      assert.equal(failed.usage.modelTurns, 0);
      assert.deepEqual((await f.request(c.draftPath)).body, c.draft);
      assert.equal(
        (await f.request("/api/services")).body.services[0].summary.releases
          .length,
        0,
      );
    } finally {
      await f.close();
    }
  },
);

test(
  "independent checks reject a wrong manual implementation despite generated tests claiming success",
  { timeout: 25000 },
  async () => {
    const f = await taskFixture({
      services: true,
      workspaces: true,
      planner: async () => {
        throw new Error("No model calls");
      },
      workspaceEffects: async () =>
        Response.json({ exitCode: 0, stdout: "all tests passed" }),
    });
    try {
      const source = content();
      source.files.find((file) => file.path === source.entrypoint).content =
        "export const execute = () => ({result: null, state: null});";
      const c = await create(f, source, "test");
      const failed = await until(f, c.task, (t) => t.state === "failed");
      assert.equal(failed.failure.code, "tests_failed");
      assert.equal(failed.stepId, "validate");
      const tests = await f.request(path(failed) + "/tests");
      expectStatus(tests, 200);
      assert.equal(tests.body.tests.generated.exitCode, 0);
      assert.equal(tests.body.tests.report.status, "failed");
      assert.equal(
        tests.body.tests.report.cases[0].failure.code,
        "invalid_reply",
      );
      assert.deepEqual((await f.request(c.draftPath)).body, c.draft);
      assert.equal(
        (await f.request("/api/services")).body.services[0].summary.releases
          .length,
        0,
      );
    } finally {
      await f.close();
    }
  },
);

test(
  "a manual edit made during testing is preserved and does not change the revision being checked",
  { timeout: 25000 },
  async () => {
    const entered = deferred(),
      release = deferred();
    const f = await taskFixture({
      services: true,
      workspaces: true,
      planner: async () => {
        throw new Error("No model calls");
      },
      workspaceEffects: async (request) => {
        if ((await request.json()).kind === "execute") {
          entered.resolve();
          await release.promise;
        }
        return Response.json({ exitCode: 0, stdout: "passed" });
      },
    });
    try {
      const c = await create(f, content(), "test");
      await entered.promise;
      const newer = await f.request(c.draftPath, {
        body: {
          actionId: randomUUID(),
          expectedRevision: 1,
          content: { ...c.draft.content, description: "Newer draft" },
        },
      });
      expectStatus(newer, 200);
      release.resolve();
      const task = await until(f, c.task, (t) =>
        ["ready", "failed"].includes(t.state),
      );
      assert.equal(task.state, "ready", JSON.stringify(task));
      assert.equal((await f.request(path(task) + "/result")).body.revision, 1);
      assert.deepEqual((await f.request(c.draftPath)).body, newer.body.draft);
      assert.equal(task.questions.length, 0);
      const summary = (await f.request("/api/services")).body.services[0]
        .summary;
      assert.equal(summary.draftRevision, 2);
      assert.equal(summary.releases[0].identity.draftRevision, 1);
      expectStatus(
        await f.request(c.draftPath.replace(/draft$/, "activate"), {
          body: {
            kind: "activate",
            actionId: randomUUID(),
            expectedRevision: summary.service.revision,
            releaseId: summary.service.testReleaseId,
          },
        }),
        409,
      );
      assert.equal(
        (await f.request("/api/services")).body.services[0].summary.service
          .liveReleaseId,
        null,
      );
    } finally {
      release.resolve();
      await f.close();
    }
  },
);
