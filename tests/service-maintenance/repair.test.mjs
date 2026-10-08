import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  taskFixture,
  expectStatus,
  path,
} from "../assistant-task-server/helpers.mjs";
import { create, until } from "../service-drafts/task.helpers.mjs";
import {
  dinnerAgreement,
  packageFor,
  dinnerSource,
} from "../service-validation/fixtures.mjs";

import { selectedTestRunner } from "./workshop.mjs";
import { draftContent, repairDecision } from "./helpers.mjs";

test(
  "repair reproduces the real rule bug before editing, preserves identity and prepares a checked inactive update",
  { timeout: 25000 },
  async () => {
    const executions = [];
    const f = await taskFixture({
      services: true,
      workspaces: true,
      planner: repairDecision,
      workspaceEffects: selectedTestRunner(executions),
    });
    try {
      const c = await create(f, draftContent(true), "repair");
      const task = await until(f, c.task, (t) =>
        ["ready", "failed"].includes(t.state),
      );
      assert.equal(task.state, "ready", JSON.stringify(task));
      const results = await f.request(path(task) + "/tests");
      expectStatus(results, 200);
      assert.equal(results.body.repair.baseline, "failed");
      assert.equal(results.body.repair.stage, "backend_rule");
      assert.equal(results.body.tests.report.status, "passed");
      assert.equal(results.body.repair.published, false);
      assert.equal(results.body.repair.checkedRevision, 3);
      const list = (await f.request("/api/services")).body.services;
      assert.equal(list.length, 1);
      assert.equal(
        list[0].metadata.identity.serviceId,
        c.draft.identity.serviceId,
      );
      assert.equal(list[0].summary.service.liveReleaseId, null);
      assert.ok(list[0].summary.service.testReleaseId);
      assert.equal(
        (await f.request(c.draftPath)).body.content.files[0].content,
        dinnerSource,
      );
      assert.deepEqual(
        executions,
        [0, 1, 0],
        "Actual selected tests pass baseline, fail original with new regression, then pass repaired source",
      );
      await f.restart();
      assert.equal(
        (await f.request(path(task) + "/tests")).body.repair.checkedRevision,
        3,
      );
      expectStatus(
        await f.request(path(task) + "/tests", { session: f.otherCookie }),
        404,
      );
    } finally {
      await f.close();
    }
  },
);

test(
  "passing baseline cannot be labelled a reproduced backend bug or used to rewrite source",
  { timeout: 25000 },
  async () => {
    let rejected = false;
    const f = await taskFixture({
      services: true,
      workspaces: true,
      workspaceEffects: async () => Response.json({ exitCode: 0 }),
      planner: async (req) => {
        const { draftContext: d } = await req.json();
        if (!rejected) {
          rejected = true;
          return Response.json({
            kind: "diagnose",
            stage: "backend_rule",
            evidenceKeys: ["baseline"],
            summary: "Invented bug",
          });
        }
        if (!d.maintenance.diagnosis)
          return Response.json({
            kind: "diagnose",
            stage: "unknown",
            evidenceKeys: ["baseline"],
            summary:
              "The safe cases pass; the failing viewer input is still needed.",
          });
        return Response.json({ kind: "done" });
      },
    });
    try {
      const c = await create(f, draftContent(), "repair");
      const task = await until(f, c.task, (t) =>
        ["ready", "failed"].includes(t.state),
      );
      assert.equal(task.state, "ready", JSON.stringify(task));
      assert.deepEqual((await f.request(c.draftPath)).body, c.draft);
      assert.equal(
        (await f.request(path(task) + "/tests")).body.repair.checkedRevision,
        null,
      );
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
  "disconnected access produces a reconnection report, zero source edits and zero provider calls during investigation",
  { timeout: 25000 },
  async () => {
    const { fixture, connectInput } =
      await import("../account-connections/helpers.mjs");
    const { connectedAgreement, connectedSource } =
      await import("../connected-services/fixtures.mjs");
    const f = await fixture({
      clock: null,
      services: true,
      workspaces: true,
      workspaceEffects: async () => Response.json({ exitCode: 0 }),
      planner: async (req) => {
        const { draftContext: d } = await req.json();
        assert.equal(d.maintenance.baseline.status, "passed");
        if (!d.maintenance.diagnosis)
          return Response.json({
            kind: "diagnose",
            stage: "external_account",
            evidenceKeys: ["connection:issue"],
            summary:
              "Account access was disconnected. Reconnect the existing account; the code passes its safe examples.",
          });
        return Response.json({ kind: "done" });
      },
    });
    try {
      expectStatus(await f.connection("connect", connectInput()), 200);
      expectStatus(
        await f.connection("disconnect", {
          id: "connection-one",
          expectedRevision: 1,
        }),
        200,
      );
      const source = connectedSource();
      const c = await create(
        f,
        {
          agreement: connectedAgreement(),
          files: source.files,
          entrypoint: source.entrypoint,
          tests: source.tests,
        },
        "repair",
      );
      const count = f.api.calls.length;
      const task = await until(f, c.task, (t) =>
        ["ready", "failed"].includes(t.state),
      );
      assert.equal(task.state, "ready", JSON.stringify(task));
      assert.deepEqual((await f.request(c.draftPath)).body, c.draft);
      assert.equal(f.api.calls.length, count);
      const report = (await f.request(path(task) + "/tests")).body.repair;
      assert.equal(report.stage, "external_account");
      assert.equal(report.checkedRevision, null);
      assert.match(report.dependencies[0].recovery, /Reconnect/);
      assert.equal((await f.request("/api/services")).body.services.length, 1);
    } finally {
      await f.close();
    }
  },
);

test("the original independent agreement and a regression test are required before code repair", async () => {
  const { acceptRepairDecision, requireRepairArtifact } =
    await import("../../server/assistant/maintenance/repair.js");
  const content = draftContent(true);
  const state = {
    draft: { revision: 1, content },
    read: { revision: 1 },
    maintenance: {
      phase: "diagnose",
      baseline: { status: "failed" },
      diagnosis: { stage: "backend_rule" },
      agreement: content.agreement,
      tests: content.files.filter((file) => content.tests.includes(file.path)),
    },
  };
  assert.throws(
    () =>
      acceptRepairDecision(state, {
        kind: "execute",
        reason: "skip regression",
      }),
    /regression/,
  );
  const changed = structuredClone(content.agreement);
  changed.cases = [];
  assert.throws(
    () =>
      acceptRepairDecision(state, {
        kind: "write",
        agreementJson: JSON.stringify(changed),
      }),
    /agreed behavior/,
  );
  assert.throws(
    () => acceptRepairDecision(state, { kind: "done" }),
    /independent checks/,
  );
  assert.throws(
    () =>
      requireRepairArtifact(
        { drafts: { get: () => state } },
        { id: "task" },
        { agreement: changed, package: content },
      ),
    /regression/,
  );
  state.maintenance.diagnosis.stage = "external_account";
  assert.throws(
    () => acceptRepairDecision(state, { kind: "replace" }),
    /reproduced backend/,
  );
});

test(
  "a regression that also passes the old code cannot create a checked repair",
  { timeout: 25000 },
  async () => {
    const f = await taskFixture({
      services: true,
      workspaces: true,
      workspaceEffects: selectedTestRunner(),
      planner: async (request) => {
        const clone = request.clone();
        const task = await request.json(),
          d = task.draftContext;
        if (d.maintenance.regression?.status === "not_reproduced")
          return Response.json({
            kind: "ask",
            prompt:
              "The new test passes the original code. Which failing input should the regression cover?",
            choices: ["Review the failing input"],
          });
        const decision = await (await repairDecision(clone)).json();
        if (decision.kind === "write")
          decision.files[1].content =
            "import assert from 'node:assert/strict'; import {execute} from '../src/service.mjs'; assert.equal(execute({operation:'join',input:{name:'Guest'},state:{capacity:1,guests:[]}}).result,'accepted'); // Changed text, unchanged coverage";
        return Response.json(decision);
      },
    });
    try {
      const c = await create(f, draftContent(true), "repair");
      const waiting = await until(f, c.task, (t) =>
        t.questions.some((q) => !q.answer),
      );
      const report = (await f.request(path(waiting) + "/tests")).body.repair;
      assert.equal(report.regression, "not_reproduced");
      assert.equal(report.checkedRevision, null);
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
  "a newer manual draft restarts diagnosis and baseline instead of reusing stale repair evidence",
  { timeout: 25000 },
  async () => {
    const { deferred } =
      await import("../assistant-task-server/workspace.helpers.mjs");
    const entered = deferred(),
      release = deferred();
    let held = false;
    const f = await taskFixture({
      services: true,
      workspaces: true,
      workspaceEffects: selectedTestRunner(),
      planner: async (request) => {
        const clone = request.clone(),
          task = await request.json(),
          d = task.draftContext;
        if (d.maintenance.baseline.status === "passed")
          return Response.json(
            d.maintenance.diagnosis
              ? { kind: "done" }
              : {
                  kind: "diagnose",
                  stage: "unknown",
                  evidenceKeys: ["baseline"],
                  summary:
                    "The newer manual code passes. The old repair evidence no longer applies.",
                },
          );
        const response = await repairDecision(clone),
          decision = await response.clone().json();
        if (decision.kind === "write" && !held) {
          held = true;
          entered.resolve();
          await release.promise;
        }
        return response;
      },
    });
    try {
      const c = await create(f, draftContent(true), "repair");
      await entered.promise;
      const newer = await f.request(c.draftPath, {
        body: {
          actionId: randomUUID(),
          expectedRevision: 1,
          content: { ...c.draft.content, ...draftContent() },
        },
      });
      expectStatus(newer, 200);
      release.resolve();
      const waiting = await until(f, c.task, (t) =>
        t.questions.some((q) => !q.answer),
      );
      const question = waiting.questions.find((q) => !q.answer);
      expectStatus(
        await f.request(path(waiting) + "/answers", {
          body: {
            expectedRevision: waiting.revision,
            questionId: question.id,
            questionRevision: 0,
            operationId: randomUUID(),
            value: "Continue from the newer saved draft",
          },
        }),
        200,
      );
      const finished = await until(f, c.task, (t) =>
        ["ready", "failed"].includes(t.state),
      );
      assert.equal(finished.state, "ready", JSON.stringify(finished));
      assert.deepEqual((await f.request(c.draftPath)).body, newer.body.draft);
      const report = (await f.request(path(finished) + "/tests")).body.repair;
      assert.equal(report.baseline, "passed");
      assert.equal(report.checkedRevision, null);
    } finally {
      release.resolve();
      await f.close();
    }
  },
);
