import {
  dinnerAgreement,
  packageFor,
} from "../service-validation/fixtures.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  taskFixture,
  expectStatus,
  path,
} from "../assistant-task-server/helpers.mjs";
import { deferred } from "../assistant-task-server/workspace.helpers.mjs";

import { create, until } from "./task.helpers.mjs";

const write = (context, content) => ({
  kind: "write",
  libraries: [],
  expectedRevision: context.revision,
  files: [{ path: "src/main.mjs", content }],
  entrypoint: context.metadata.entrypoint,
  tests: context.metadata.tests,
  agreementJson: JSON.stringify(context.metadata.agreement),
});

test(
  "an unconfirmed AI save recovers its exact receipt after a full server restart",
  { timeout: 25000 },
  async () => {
    let fail = true;
    const commands = [];
    const f = await taskFixture({
      services: true,
      draftControl: async (request) => {
        const value = await request.json();
        if (value.phase === "before") commands.push(value.input);
        if (value.phase === "after" && fail) {
          fail = false;
          return Response.json({ fail: true });
        }
        return Response.json({});
      },
      planner: async (request) => {
        const { draftContext: d } = await request.json();
        return Response.json(
          d.revision === 1
            ? write(d, "// saved exactly once")
            : { kind: "done" },
        );
      },
    });
    try {
      const c = await create(f);
      const failed = await until(f, c.task, (t) => t.state === "failed");
      assert.equal(failed.stepId, "draft_apply");
      assert.equal((await f.request(c.draftPath)).body.revision, 2);
      await f.restart();
      expectStatus(
        await f.request(path(c.task) + "/resume", {
          body: { expectedRevision: failed.revision },
        }),
        200,
      );
      const ready = await until(
        f,
        c.task,
        (t) => t.state === "ready" || t.state === "failed",
      );
      assert.equal(ready.state, "ready");
      assert.deepEqual(commands[1], commands[0]);
      assert.equal((await f.request(c.draftPath)).body.revision, 2);
    } finally {
      await f.close();
    }
  },
);

test(
  "Stop fences an already dispatched draft save before a delayed RPC can write",
  { timeout: 25000 },
  async () => {
    const entered = deferred(),
      release = deferred(),
      settled = deferred();
    const f = await taskFixture({
      services: true,
      draftControl: async (request) => {
        const value = await request.json();
        if (value.phase === "before") {
          entered.resolve();
          await release.promise;
        } else settled.resolve();
        return Response.json({});
      },
      planner: async (request) =>
        Response.json(
          write((await request.json()).draftContext, "// delayed write"),
        ),
    });
    try {
      const c = await create(f);
      await entered.promise;
      const running = await until(
        f,
        c.task,
        (t) => t.state === "running" && t.stepId === "draft_apply",
      );
      expectStatus(
        await f.request(path(c.task) + "/stop", {
          body: { expectedRevision: running.revision },
        }),
        200,
      );
      release.resolve();
      await settled.promise;
      assert.equal((await f.request(c.draftPath)).body.revision, 1);
      await f.restart();
      assert.equal((await f.request(c.draftPath)).body.revision, 1);
    } finally {
      release.resolve();
      await f.close();
    }
  },
);

test(
  "required development execution restores the saved source, checks it and keeps the same inactive Container",
  { timeout: 25000 },
  async () => {
    let starts = 0;
    const f = await taskFixture({
      services: true,
      workspaces: true,
      workspaceEffects: async (request) => {
        if ((await request.json()).kind === "start") starts++;
        return Response.json({ exitCode: 0, stdout: "generated tests ran" });
      },
      planner: async (request) => {
        const task = await request.json();
        if (task.stepId === "plan")
          return Response.json({
            kind: "execute",
            reason:
              "Run the saved service tests and independent behavior checks",
          });
        const write = task.builderContext.feedback.find(
          (row) => row.kind === "workspace_write",
        );
        assert.ok(
          write,
          "existing builder restored the draft before requesting another decision",
        );
        const ref = write.result.result;
        return Response.json({
          kind: "tools",
          calls: [
            { kind: "workspace_start", ...ref },
            {
              kind: "workspace_test",
              ...ref,
              paths: ["tests/service.test.mjs"],
            },
          ],
          review: {
            kind: "review",
            libraries: [],
            ...ref,
            entrypoint: "src/service.mjs",
            tests: ["tests/service.test.mjs"],
          },
        });
      },
    });
    try {
      const { files, entrypoint, tests } = packageFor();
      const c = await create(f, {
        files,
        entrypoint,
        tests,
        agreement: dinnerAgreement(),
      });
      const task = await until(
        f,
        c.task,
        (t) => t.state === "ready" || t.state === "failed",
      );
      assert.equal(task.state, "ready", JSON.stringify(task));
      const saved = (await f.request(c.draftPath)).body;
      assert.equal(saved.revision, 2);
      assert.deepEqual(saved.content.files, files);
      const list = await f.request("/api/services");
      expectStatus(list, 200);
      assert.equal(list.body.services.length, 1);
      assert.equal(
        list.body.services[0].metadata.identity.serviceId,
        c.draft.identity.serviceId,
      );
      assert.equal(list.body.services[0].summary.service.liveReleaseId, null);
      const workspaces = (await f.control({ action: "workspace-rows" })).body;
      assert.equal(workspaces.links.length, 1);
      await f.control({ action: "workspace-reconcile" });
      const status = (
        await f.control({
          action: "workspace-status",
          identity: workspaces.links[0].identity,
        })
      ).body;
      assert.equal(status.stats.vm.starts, 1);
      assert.equal(status.stats.vm.running, false);
      assert.equal(
        status.observation.source.files[0].content,
        files[0].content,
      );
    } finally {
      await f.close();
    }
  },
);

test(
  "saved AI edit uses the manual draft, finishes without a workshop and survives restart",
  { timeout: 25000 },
  async () => {
    let starts = 0;
    const f = await taskFixture({
      services: true,
      workspaces: true,
      workspaceEffects: async () => {
        starts++;
        throw new Error("No workshop for an edit");
      },
      planner: async (request) => {
        const { draftContext: d } = await request.json();
        if (d.revision === 2) return Response.json({ kind: "done" });
        if (!d.read)
          return Response.json({
            kind: "read",
            path: "src/main.mjs",
            offset: 0,
          });
        assert.equal(d.read.content, "// my manual code");
        return Response.json(write(d, d.read.content + "\n// helpful comment"));
      },
    });
    try {
      const c = await create(f),
        result = await until(
          f,
          c.task,
          (t) => t.state === "ready" || t.state === "failed",
        );
      assert.equal(result.state, "ready", JSON.stringify(result));
      assert.equal(result.usage.modelTurns, 3);
      assert.equal(result.usage.toolCalls, 0);
      assert.equal(starts, 0);
      const saved = await f.request(c.draftPath);
      expectStatus(saved, 200);
      assert.equal(
        saved.body.content.files[0].content,
        "// my manual code\n// helpful comment",
      );
      const receipt = await f.request(path(c.task) + "/result");
      expectStatus(receipt, 200);
      assert.equal(receipt.body.kind, "container_draft");
      assert.equal(receipt.body.revision, 2);
      await f.restart();
      assert.deepEqual((await f.request(c.draftPath)).body, saved.body);
      assert.deepEqual(
        (await f.request(path(c.task) + "/result")).body,
        receipt.body,
      );
      expectStatus(
        await f.create(c.draft.identity.projectId, c.taskInput),
        200,
      );
      assert.equal((await f.request("/api/services")).body.services.length, 1);
    } finally {
      await f.close();
    }
  },
);

test(
  "a newer manual edit becomes a saved question instead of being overwritten",
  { timeout: 25000 },
  async () => {
    const entered = deferred(),
      release = deferred();
    let calls = 0;
    const f = await taskFixture({
      services: true,
      planner: async (request) => {
        const task = await request.json();
        calls++;
        if (calls === 1) {
          entered.resolve();
          await release.promise;
          return Response.json(write(task.draftContext, "// stale AI"));
        }
        assert.equal(task.draftContext.revision, 2);
        return Response.json({ kind: "done" });
      },
    });
    try {
      const c = await create(f);
      await entered.promise;
      const manual = await f.request(c.draftPath, {
        body: {
          actionId: randomUUID(),
          expectedRevision: 1,
          content: {
            ...c.draft.content,
            files: [{ path: "src/main.mjs", content: "// newer manual" }],
          },
        },
      });
      expectStatus(manual, 200);
      release.resolve();
      const waiting = await until(
        f,
        c.task,
        (t) => t.state === "waiting_for_answer",
      );
      assert.equal(
        (await f.request(c.draftPath)).body.content.files[0].content,
        "// newer manual",
      );
      await f.restart();
      const q = waiting.questions.at(-1);
      expectStatus(
        await f.request(path(c.task) + "/answers", {
          body: {
            expectedRevision: waiting.revision,
            questionId: q.id,
            questionRevision: q.revision,
            operationId: randomUUID(),
            value: "Continue from the newer saved draft",
          },
        }),
        200,
      );
      const ready = await until(
        f,
        c.task,
        (t) => t.state === "ready" || t.state === "failed",
      );
      assert.equal(ready.state, "ready", JSON.stringify(ready));
      assert.equal(
        (await f.request(c.draftPath)).body.content.files[0].content,
        "// newer manual",
      );
    } finally {
      release.resolve();
      await f.close();
    }
  },
);

test(
  "Stop while an AI decision is in flight leaves the saved draft intact",
  { timeout: 25000 },
  async () => {
    const entered = deferred(),
      release = deferred();
    const f = await taskFixture({
      services: true,
      planner: async (request) => {
        const task = await request.json();
        entered.resolve();
        await release.promise;
        return Response.json(write(task.draftContext, "// late AI"));
      },
    });
    try {
      const c = await create(f);
      await entered.promise;
      const running = await until(f, c.task, (t) => t.state === "running");
      expectStatus(
        await f.request(path(c.task) + "/stop", {
          body: { expectedRevision: running.revision },
        }),
        200,
      );
      release.resolve();
      await until(
        f,
        c.task,
        (t) => t.state === "stopped" && t.usage.reservedModelTurns === 0,
      );
      assert.equal((await f.request(c.draftPath)).body.revision, 1);
      await f.restart();
      assert.equal((await f.request(c.draftPath)).body.revision, 1);
    } finally {
      release.resolve();
      await f.close();
    }
  },
);

test(
  "source and expanded test context survives alternating reads while unrelated large source stays bounded",
  { timeout: 25000 },
  async () => {
    const original = [
      { path: "src/main.mjs", content: "// creator source 🧪" },
      {
        path: "tests/manual.test.mjs",
        content: "// creator test\n" + "// Unicode regression 🧪\n".repeat(250),
      },
      {
        path: "src/large.mjs",
        content: "// large manual file\n" + "x".repeat(60000),
      },
      ...Array.from({ length: 14 }, (_, index) => ({
        path: `src/retained${index}.mjs`,
        content: "// bounded current context\n" + "x".repeat(10000),
      })),
    ];
    const f = await taskFixture({
      services: true,
      planner: async (request) => {
        const { draftContext: d } = await request.json();
        if (d.revision !== 1) return Response.json({ kind: "done" });
        const main = d.files.find((file) => file.path === original[0].path);
        const checks = d.files.find((file) => file.path === original[1].path);
        const large = d.files.find((file) => file.path === original[2].path);
        assert.equal(main.content, original[0].content);
        assert.equal(checks.content, original[1].content);
        assert.equal(Object.hasOwn(large, "content"), false);
        const inline = d.files.filter((file) => Object.hasOwn(file, "content"));
        assert.ok(inline.length < d.files.length - 1);
        assert.ok(
          inline.reduce(
            (sum, file) => sum + new TextEncoder().encode(file.content).length,
            0,
          ) <=
            128 * 1024,
        );
        if (!d.read)
          return Response.json({ kind: "read", path: main.path, offset: 0 });
        if (d.read.path === main.path)
          return Response.json({ kind: "read", path: checks.path, offset: 0 });
        return Response.json({
          ...write(d, main.content + "\n// requested edit"),
          files: [
            { path: main.path, content: main.content + "\n// requested edit" },
            {
              path: checks.path,
              content: checks.content + "\n// regression added",
            },
          ],
        });
      },
    });
    try {
      const c = await create(f, { files: original });
      const ready = await until(
        f,
        c.task,
        (task) => task.state === "ready" || task.state === "failed",
      );
      assert.equal(ready.state, "ready");
      await f.restart();
      const draft = (await f.request(c.draftPath)).body;
      assert.equal(draft.revision, 2);
      assert.deepEqual(draft.content.files, [
        {
          ...original[0],
          content: original[0].content + "\n// requested edit",
        },
        {
          ...original[1],
          content: original[1].content + "\n// regression added",
        },
        ...original.slice(2),
      ]);
    } finally {
      await f.close();
    }
  },
);
