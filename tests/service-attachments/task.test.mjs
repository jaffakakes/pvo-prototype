import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { expectStatus, NOW, path } from "../assistant-task-server/helpers.mjs";
import {
  current,
  deferred,
} from "../assistant-task-server/provider.helpers.mjs";
import { proposal, setup } from "./task.helpers.mjs";
import { serializePreparedTaskResult } from "../../packages/pvo-assistant/results/index.js";

test("the durable attach runner compiles a public connection and saves owned immutable result bytes across full restart", async () => {
  const { f, task, calls } = await setup();
  try {
    expectStatus(await f.control({ action: "sweep" }), 200);
    const ready = await current(f, task);
    assert.equal(ready.state, "ready", JSON.stringify(ready.failure));
    assert.equal(ready.usage.modelTurns, 1);
    assert.equal(ready.usage.reservedModelTurns, 0);
    assert.equal(calls.length, 1);
    assert.deepEqual(
      calls[0].attachmentContext.operations.map((operation) => operation.name),
      ["join"],
    );
    assert.deepEqual(Object.keys(calls[0].attachmentContext).sort(), [
      "operations",
      "releaseId",
      "url",
    ]);
    const result = await f.request(path(task) + "/result");
    expectStatus(result, 200);
    assert.equal(result.body.attachment.receipt.identity.ownerId, task.ownerId);
    assert.equal(result.body.attachment.receipt.identity.taskId, task.id);
    assert.equal(result.body.attachment.receipt.readiness.state, "available");
    assert.deepEqual(result.body.operations, [
      result.body.attachment.command.component,
    ]);
    const bytes = serializePreparedTaskResult(result.body);
    assert.equal(
      ready.result.artifact.sha256,
      createHash("sha256").update(bytes).digest("hex"),
    );
    expectStatus(
      await f.request(path(task) + "/result", { session: f.otherCookie }),
      404,
    );
    const catalog = (await f.control({ action: "service-catalog" })).body;
    assert.equal(
      catalog[0].service.state,
      "inactive",
      "saving a component never activates its service",
    );
    await f.restart();
    assert.deepEqual(
      (await f.request(path(task) + "/result")).body,
      result.body,
    );
    assert.equal((await f.control({ action: "results" })).body.count, 1);
  } finally {
    await f.close();
  }
});

test("invalid source, invented release, wrong control and hidden originals cannot produce a ready attachment", async () => {
  for (const failure of ["source", "release", "control", "original"]) {
    const { f, task } = await setup({
      propose: (task) => {
        const command = proposal(task);
        if (failure === "source")
          command.component.source.structure = "<script>bad</script>";
        if (failure === "release") command.connection.releaseId = "invented";
        if (failure === "control") command.connection.target = "invented";
        if (failure === "original")
          command.component = {
            kind: "component.source",
            sceneId: "scene-one",
            componentId: "missing",
            source: command.component.source,
          };
        return command;
      },
    });
    try {
      expectStatus(await f.control({ action: "sweep" }), 200);
      assert.equal((await current(f, task)).state, "queued");
      expectStatus(await f.control({ action: "sweep" }), 200);
      const end = await current(f, task);
      assert.equal(end.state, "waiting_for_answer");
      assert.equal(end.failure, null);
      assert.equal(end.usage.modelTurns, 3);
      assert.ok(end.questions[0].choices.includes("Keep repairing"));
      assert.equal(end.result, null);
      assert.equal((await f.control({ action: "results" })).body.count, 0);
    } finally {
      await f.close();
    }
  }
});

test("Stop during real provider lookup fences a late prepared attachment and settles its metered turn", async () => {
  const entered = deferred(),
    release = deferred();
  let holding = false;
  const { f, task } = await setup({
    providerControl: async (request) => {
      const value = await request.json();
      if (holding && value.action === "lookup" && value.phase === "after") {
        entered.resolve();
        await release.promise;
      }
      return Response.json({});
    },
  });
  try {
    holding = true;
    const running = f.control({ action: "sweep" });
    await entered.promise;
    const latest = await current(f, task);
    expectStatus(
      await f.request(path(task) + "/stop", {
        body: { expectedRevision: latest.revision },
      }),
      200,
    );
    release.resolve();
    await running;
    const stopped = await current(f, task);
    assert.equal(stopped.state, "stopped");
    assert.equal(stopped.result, null);
    assert.equal(stopped.usage.modelTurns, 1);
    assert.equal(stopped.usage.reservedModelTurns, 0);
    assert.equal((await f.control({ action: "results" })).body.count, 0);
  } finally {
    release.resolve();
    await f.close();
  }
});

test("result storage failure rolls back ready state and its inference receipt together", async () => {
  const { f, task } = await setup();
  try {
    expectStatus(await f.control({ action: "fail-result-write" }), 200);
    expectStatus(await f.control({ action: "sweep" }), 409);
    const end = await current(f, task);
    assert.notEqual(end.state, "ready");
    assert.equal(end.result, null);
    assert.equal((await f.control({ action: "results" })).body.count, 0);
    assert.equal(
      end.operations.find((operation) => operation.stepId === "attach").status,
      "planned",
    );
    assert.equal(
      end.usage.reservedModelTurns,
      1,
      "the lost completion remains reserved for recovery",
    );
  } finally {
    await f.close();
  }
});

test("compiler feedback and rejected source survive restart, then repaired source passes real checks", async () => {
  let count = 0;
  const { f, task, calls } = await setup({
    propose: (task) => {
      const command = proposal(task);
      if (++count <= 2)
        command.component.source.structure = "<script>bad</script>";
      return command;
    },
  });
  try {
    expectStatus(await f.control({ action: "sweep" }), 200);
    assert.equal((await current(f, task)).state, "queued");
    const feedback = calls[1].evidenceContext.repair;
    assert.equal(feedback.check, "component_validation");
    assert.match(feedback.message, /[Ss]tructure/);
    assert.ok(feedback.proposal.text.includes("<script>bad</script>"));
    await f.restart();
    expectStatus(await f.control({ action: "sweep" }), 200);
    const ready = await current(f, task);
    assert.equal(ready.state, "ready", JSON.stringify(ready.failure));
    assert.equal(ready.usage.modelTurns, 3);
    assert.equal(calls[2].evidenceContext.repair.repetitions, 2);
    assert.equal(
      ready.operations.filter((row) => row.failure?.code === "invalid_result")
        .length,
      2,
    );
    assert.equal((await f.control({ action: "results" })).body.count, 1);
    const request = {
      kind: "history",
      collection: "repairs",
      after: 0,
      offset: 0,
      notes: "",
    };
    const history = await f.control({
      action: "select-evidence",
      id: task.id,
      request,
    });
    expectStatus(history, 200);
    assert.equal(JSON.parse(history.body.content).message, feedback.message);
    expectStatus(
      await f.request("/__test", {
        session: f.otherCookie,
        body: { action: "select-evidence", id: task.id, request },
      }),
      409,
    );
  } finally {
    await f.close();
  }
});

test("answering a repeated-check help question resumes the same attachment without a goal-wide retry limit", async () => {
  let invalid = true;
  const { f, task, calls } = await setup({
    propose: (task) => {
      const command = proposal(task);
      if (invalid) command.component.source.structure = "<script>bad</script>";
      return command;
    },
  });
  try {
    for (let round = 0; round < 4; round++) {
      await f.control({ action: "sweep" });
      await f.control({ action: "sweep" });
      const waiting = await current(f, task);
      assert.equal(waiting.state, "waiting_for_answer");
      assert.equal(waiting.usage.modelTurns, (round + 1) * 3);
      assert.equal(calls.at(-1).evidenceContext.repair.repetitions, 2);
      const question = waiting.questions.at(-1);
      expectStatus(
        await f.request(path(task) + "/answers", {
          body: {
            expectedRevision: waiting.revision,
            questionId: question.id,
            questionRevision: 0,
            operationId: `continue-repair-${round}`,
            value: "Keep repairing",
          },
        }),
        200,
      );
      // Capacity can replenish without expiring the unfinished goal.
      await f.control({ action: "time", now: NOW + (round + 1) * 60000 });
    }
    invalid = false;
    await f.restart();
    await f.control({ action: "time", now: NOW + 4 * 60000 });
    expectStatus(await f.control({ action: "sweep" }), 200);
    const ready = await current(f, task);
    assert.equal(ready.state, "ready");
    assert.equal(ready.usage.modelTurns, 13);
  } finally {
    await f.close();
  }
});

test("an expired inactive connection is replaced after cleanup and restart, keeping checked source and the same goal", async () => {
  let invalid = true;
  const { f, task, calls } = await setup({
    propose: (task) => {
      const command = proposal(task);
      if (invalid) command.component.source.structure = "<script>bad</script>";
      return command;
    },
  });
  try {
    await f.control({ action: "sweep" });
    await f.control({ action: "sweep" });
    const waiting = await current(f, task);
    assert.equal(waiting.state, "waiting_for_answer");
    const original = (await f.control({ action: "provider-rows" })).body[0];
    const later = original.identity.expiresAt + 1000;
    await f.restart();
    await f.control({ action: "time", now: later });
    invalid = false;
    const question = waiting.questions.at(-1);
    expectStatus(
      await f.request(path(task) + "/answers", {
        body: {
          expectedRevision: waiting.revision,
          questionId: question.id,
          questionRevision: 0,
          operationId: "answer-after-host-expiry",
          value: "Keep repairing",
        },
      }),
      200,
    );
    expectStatus(await f.control({ action: "sweep" }), 200);
    expectStatus(await f.control({ action: "sweep" }), 200);
    const ready = await current(f, task);
    assert.equal(ready.state, "ready", JSON.stringify(ready));
    const rows = (await f.control({ action: "provider-rows" })).body;
    assert.equal(rows.length, 2);
    const old = rows.find((row) => row.id === original.id),
      fresh = rows.find((row) => row.id !== original.id);
    assert.equal(old.cancelled, true);
    assert.deepEqual(old.identity, original.identity);
    assert.notEqual(fresh.identity.serviceId, old.identity.serviceId);
    assert.notEqual(fresh.identity.resourceId, old.identity.resourceId);
    assert.equal(fresh.identity.expiresAt, later + 86400000);
    for (const key of [
      "agreementDigest",
      "packageDigest",
      "sourceDigest",
      "reportDigest",
    ])
      assert.equal(fresh.identity[key], old.identity[key]);
    assert.equal(
      ready.usage.modelTurns,
      4,
      "Replacing a checked host needs no new model inference",
    );
    assert.equal(ready.usage.toolCalls, 2);
    assert.equal(
      calls.at(-1).attachmentContext.releaseId,
      fresh.identity.resourceId,
    );
    const result = await f.request(path(task) + "/result");
    assert.equal(
      result.body.attachment.receipt.identity.serviceId,
      fresh.identity.serviceId,
    );
    const oldStatus = (
      await f.control({ action: "provider-status", identity: old.identity })
    ).body;
    assert.equal(oldStatus.observation.state, "deleted");
    assert.equal(oldStatus.stats.sourcePresent, false);
    assert.equal(oldStatus.stats.calls, 1);
    assert.equal(
      (await f.control({ action: "provider-status", identity: fresh.identity }))
        .body.stats.calls,
      1,
    );
    const catalog = (await f.control({ action: "service-catalog" })).body;
    assert.equal(
      catalog.find(
        (item) => item.service.identity.serviceId === old.identity.serviceId,
      ).service.state,
      "deleted",
    );
    await f.restart();
    await f.control({ action: "time", now: later });
    assert.equal((await current(f, task)).state, "ready");
    assert.deepEqual(
      (await f.request(path(task) + "/result")).body,
      result.body,
    );
  } finally {
    await f.close();
  }
});

test("unknown expired-host cleanup creates no replacement and Stop prevents later recovery from reviving the goal", async () => {
  let failLookup = false;
  const { f, task, calls } = await setup({
    propose: (task) => {
      const command = proposal(task);
      command.component.source.structure = "<script>bad</script>";
      return command;
    },
    providerControl: async (request) => {
      const value = await request.json();
      return Response.json({ fail: failLookup && value.action === "lookup" });
    },
  });
  try {
    await f.control({ action: "sweep" });
    await f.control({ action: "sweep" });
    const waiting = await current(f, task);
    const original = (await f.control({ action: "provider-rows" })).body[0];
    await f.control({
      action: "time",
      now: original.identity.expiresAt + 1000,
    });
    const question = waiting.questions.at(-1);
    expectStatus(
      await f.request(path(task) + "/answers", {
        body: {
          expectedRevision: waiting.revision,
          questionId: question.id,
          questionRevision: 0,
          operationId: "answer-expired-unknown",
          value: "Keep repairing",
        },
      }),
      200,
    );
    failLookup = true;
    expectStatus(await f.control({ action: "sweep" }), 200);
    assert.equal((await f.control({ action: "provider-rows" })).body.length, 1);
    assert.equal(calls.length, 3);
    const pending = await current(f, task);
    assert.equal(pending.state, "queued");
    expectStatus(
      await f.request(path(task) + "/stop", {
        body: { expectedRevision: pending.revision },
      }),
      200,
    );
    const row = (await f.control({ action: "provider-rows" })).body[0];
    failLookup = false;
    await f.control({ action: "time", now: row.nextAt });
    await f.control({ action: "sweep" });
    assert.equal((await current(f, task)).state, "stopped");
    const final = (await f.control({ action: "provider-rows" })).body;
    assert.equal(final.length, 1);
    assert.equal(final[0].cancelled, true);
    assert.equal(
      (
        await f.control({
          action: "provider-status",
          identity: original.identity,
        })
      ).body.stats.calls,
      1,
    );
    assert.equal(calls.length, 3);
  } finally {
    await f.close();
  }
});
