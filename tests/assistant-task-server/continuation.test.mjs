import assert from "node:assert/strict";
import test from "node:test";
import { taskFixture, path, expectStatus, NOW } from "./helpers.mjs";
import { current, deferred, rows, status } from "./workspace.helpers.mjs";
import { proposal } from "../service-attachments/task.helpers.mjs";
import {
  dinnerAgreement,
  dinnerSource,
  packageFor,
} from "../service-validation/fixtures.mjs";
import { question } from "../assistant-tasks/fixtures.mjs";

const DAY = 86400000;
const revisions = 65;
const sourceFiles = (revision) =>
  packageFor(`${dinnerSource}\n// Saved iteration ${revision}\n`).files;
const batch = (calls) => ({ kind: "tools", calls, review: null });
const builder = async (fixture, task) =>
  (await fixture.control({ action: "builder-state", id: task.id })).body;
const latestWrite = (context) =>
  context.feedback.findLast(
    (item) =>
      item.kind === "workspace_write" && item.result.status === "completed",
  );

// Decisions depend on persisted evidence, so a lost inference cannot skip a source revision.
function nextBuild(context) {
  if (!context.agreement)
    return { kind: "agreement", agreement: dinnerAgreement() };
  const write = latestWrite(context);
  const reference = write?.result.result;
  const revision = reference?.revision ?? 0;
  if (
    revision % 10 === 5 &&
    context.feedback.indexOf(write) >
      context.feedback.findLastIndex(
        (item) =>
          item.kind === "workspace_test" && item.result.status === "completed",
      )
  ) {
    return batch([
      { kind: "workspace_start", ...reference },
      { kind: "workspace_check", ...reference, path: "src/service.mjs" },
      {
        kind: "workspace_test",
        ...reference,
        paths: ["tests/service.test.mjs"],
      },
    ]);
  }
  if (revision < revisions)
    return batch([
      {
        kind: "workspace_write",
        expectedRevision: revision,
        files: sourceFiles(revision + 1),
      },
    ]);
  return {
    kind: "review",
    libraries: [],
    ...reference,
    entrypoint: "src/service.mjs",
    tests: ["tests/service.test.mjs"],
  };
}

test(
  "one saved goal crosses old lifetime and work limits, waits, restarts, and recovers uncertain effects before a checked attachment",
  { timeout: 60000 },
  async (t) => {
    const entered = deferred(),
      release = deferred();
    let models = 0,
      commands = 0,
      lostInference = false,
      lostPublication = false;
    const fixture = await taskFixture({
      clock: NOW,
      spending: false,
      services: true,
      workspaces: true,
      workspaceEffects: async (request) => {
        if ((await request.json()).kind === "execute") commands++;
        return Response.json({
          exitCode: 0,
          stdout: "Controlled workshop command completed",
        });
      },
      providerControl: async (request) => {
        const value = await request.json();
        if (
          value.phase === "after" &&
          value.action === "publish" &&
          !lostPublication
        ) {
          lostPublication = true;
          return Response.json({ fail: true });
        }
        return Response.json({});
      },
      planner: async (request) => {
        models++;
        const task = await request.json();
        if (task.stepId === "plan")
          return Response.json(
            task.questions.length
              ? { kind: "checkpoint", stepId: "build" }
              : { kind: "ask", question: question() },
          );
        if (task.stepId === "attach") return Response.json(proposal(task));
        assert.equal(task.stepId, "build");
        if (
          !lostInference &&
          (latestWrite(task.builderContext)?.result.result.revision ?? 0) >= 30
        ) {
          lostInference = true;
          entered.resolve();
          await release.promise;
          return Response.json({
            kind: "ask",
            prompt: "Stale reply from the destroyed worker",
            choices: [],
          });
        }
        return Response.json(nextBuild(task.builderContext));
      },
    });
    let now = NOW;
    const control = async (body) => {
      const response = await fixture.control(body);
      expectStatus(response, 200);
      return response.body;
    };
    const setTime = async (value) => {
      now = value;
      await control({ action: "time", now });
    };
    const sweep = () => control({ action: "sweep" });
    try {
      const project = await fixture.project();
      expectStatus(project, 200);
      const created = await fixture.create(project.body.project.id, {
        request: dinnerAgreement().description,
        examples: [
          {
            id: "last-place",
            input: "One available place; Alice then Bob accept.",
            expected: "Alice is accepted; Bob is told full.",
          },
        ],
      });
      expectStatus(created, 201);
      const original = created.body.task;
      const read = () => current(fixture, original);
      const resume = async () =>
        expectStatus(
          await fixture.request(path(original) + "/resume", {
            body: { expectedRevision: (await read()).revision },
          }),
          200,
        );
      const grant = async (expiresAt) =>
        control({
          action: "grant-spending",
          grants: [
            {
              ownerId: original.ownerId,
              capabilities: ["model", "workspace", "hosting"],
              expiresAt,
            },
          ],
        });
      await sweep();
      assert.deepEqual((await read()).wait, { reason: "spending_permission" });
      assert.equal(models, 0);
      assert.equal(commands, 0);
      await fixture.restart();
      await setTime(now);
      await grant(NOW + 5 * DAY);
      await resume();
      await sweep();
      const asked = await read();
      assert.equal(asked.state, "waiting_for_answer");
      const answer = {
        expectedRevision: asked.revision,
        questionId: "date",
        questionRevision: 0,
        operationId: "answer-date",
        value: "Friday",
      };
      expectStatus(
        await fixture.request(path(original) + "/answers", { body: answer }),
        200,
      );

      let advanced = false,
        restarted = false,
        recoveredInference = false;
      const waits = new Set();
      let firstReceipt;
      for (let wakeup = 0; wakeup < 250; wakeup++) {
        const task = await read();
        if (task.state === "ready") break;
        if (task.state === "failed") {
          assert.equal(task.failure.code, "reconciliation_required");
          assert.equal(task.stepId, "host");
          assert.equal(lostPublication, true);
          await sweep();
          continue;
        }
        assert.notEqual(
          task.state,
          "waiting_for_answer",
          JSON.stringify(task.questions),
        );
        assert.equal(task.finishedAt, null);
        assert.equal(task.expiresAt, null);
        if (task.state === "waiting") {
          waits.add(task.wait.reason);
          assert.ok(
            [
              "model_capacity",
              "model_allowance",
              "workspace_capacity",
              "workspace_allowance",
            ].includes(task.wait.reason),
            JSON.stringify(task.wait),
          );
          assert.ok(task.nextRunAt > now);
          await setTime(task.nextRunAt);
        }
        const state = await builder(fixture, original);
        const revision = latestWrite(state)?.result.result.revision ?? 0;
        if (!advanced && revision >= 10 && task.state === "queued") {
          advanced = true;
          const before = await rows(fixture);
          firstReceipt = before.operations.find((row) => row.kind === "save");
          const calls = models;
          await setTime(now + 30 * DAY);
          await sweep();
          const waiting = await read();
          assert.deepEqual(waiting.wait, { reason: "spending_permission" });
          assert.equal(
            models,
            calls,
            "Expired permission starts no new inference",
          );
          assert.deepEqual(waiting.input, original.input);
          assert.deepEqual(await builder(fixture, original), state);
          await grant(now + 100 * DAY);
          await resume();
        }
        if (!restarted && revision >= 20 && task.state === "queued") {
          restarted = true;
          const before = await read();
          await fixture.restart();
          await setTime(now);
          assert.deepEqual(await read(), before);
          assert.deepEqual(await builder(fixture, original), state);
        }
        const pending = sweep();
        const outcome = recoveredInference
          ? await pending
          : await Promise.race([
              pending.then(() => "settled"),
              entered.promise.then(() => "lost"),
            ]);
        if (outcome === "lost") {
          recoveredInference = true;
          const running = await read();
          assert.equal(running.state, "running");
          const before = await builder(fixture, original);
          // The real local runtime is destroyed while the controlled model reply is still pending.
          const completion = pending.catch(() => null);
          await fixture.restart();
          release.resolve();
          await completion;
          await setTime(running.claim.expiresAt + 1);
          assert.deepEqual(await builder(fixture, original), before);
        }
      }
      const ready = await read();
      assert.equal(ready.state, "ready", JSON.stringify(ready));
      assert.equal(
        advanced && restarted && recoveredInference && lostPublication,
        true,
      );
      assert.ok(waits.has("model_capacity"));
      assert.ok(waits.has("model_allowance"));
      assert.ok(now - original.createdAt > 30 * DAY);
      assert.deepEqual(ready.input, original.input);
      assert.equal(ready.questions.length, 1);
      assert.equal(ready.questions[0].answer.value, "Friday");
      assert.ok(ready.retries >= 1);
      assert.ok(ready.archivedOperations > 64);
      assert.ok(ready.operations.length <= 64);
      assert.equal(ready.usage.reservedModelTurns, 0);
      assert.equal(ready.usage.reservedToolCalls, 0);
      assert.equal(ready.usage.modelTurns, models);
      assert.ok(models > 65);

      const state = await builder(fixture, original);
      assert.deepEqual(state.agreement.body, dinnerAgreement());
      const work = await rows(fixture);
      const saves = work.operations.filter((row) => row.kind === "save");
      assert.equal(
        saves.length,
        revisions,
        "Lost inference never duplicates or skips a write",
      );
      assert.deepEqual(
        saves.map((row) => row.receipt.result.revision).sort((a, b) => a - b),
        Array.from({ length: revisions }, (_, index) => index + 1),
      );
      assert.deepEqual(
        saves.find((row) => row.operationId === firstReceipt.operationId),
        firstReceipt,
      );
      const computer = await status(fixture, work.links[0].identity);
      assert.equal(computer.observation.source.revision, revisions);
      assert.deepEqual(
        computer.observation.source.files,
        sourceFiles(revisions),
      );
      assert.equal(computer.stats.vm.starts, 7);
      assert.equal(computer.stats.vm.running, false);
      assert.equal(commands, 14);
      const checked = await control({
        action: "validation-state",
        id: original.id,
      });
      assert.equal(checked.artifacts.length, 1);
      assert.equal(checked.artifacts[0].report.status, "passed");
      assert.deepEqual(
        checked.artifacts[0].artifact.package.files,
        sourceFiles(revisions),
      );
      assert.equal(
        checked.artifacts[0].artifact.identity.sourceDigest,
        computer.observation.source.digest,
      );
      assert.equal(checked.attempts.length, 5);
      assert.ok(
        checked.attempts.every(
          (attempt) => attempt.settled && attempt.status === "completed",
        ),
      );
      const publications = await control({ action: "provider-rows" });
      assert.equal(publications.length, 1);
      const publication = publications[0];
      assert.equal(publication.settled, true);
      assert.equal(publication.outcome, "completed");
      const host = await control({
        action: "provider-status",
        identity: publication.identity,
      });
      assert.equal(host.stats.calls, 1);
      assert.equal(host.observation.state, "available");
      assert.equal(
        ready.usage.toolCalls,
        revisions + 7 * 3 + 5 + 1,
        "Writes, workshop tools, package capture, independent steps and publication are charged once",
      );
      const result = await fixture.request(path(original) + "/result");
      expectStatus(result, 200);
      assert.equal(
        result.body.attachment.receipt.identity.resourceId,
        publication.identity.resourceId,
      );
      assert.equal(result.body.attachment.receipt.readiness.state, "available");
      expectStatus(
        await fixture.request(path(original), { session: fixture.otherCookie }),
        404,
      );
      expectStatus(
        await fixture.request(path(original) + "/result", {
          session: fixture.otherCookie,
        }),
        404,
      );
      const attempts = await control({ action: "attempt-rows" });
      assert.ok(
        attempts.every((attempt) => attempt.finished && attempt.budgetSettled),
      );
      const history = await control({
        action: "operation-history",
        id: original.id,
        after: 0,
      });
      await fixture.restart();
      await setTime(now);
      assert.deepEqual(await read(), ready);
      assert.deepEqual(
        (await fixture.request(path(original) + "/result")).body,
        result.body,
      );
      assert.deepEqual(
        await control({
          action: "operation-history",
          id: original.id,
          after: 0,
        }),
        history,
      );
      const replay = await fixture.create(
        original.input.projectId,
        original.input,
      );
      expectStatus(replay, 200);
      assert.deepEqual(replay.body.task, ready);
      assert.equal(models, ready.usage.modelTurns);
      assert.equal(
        (await control({ action: "service-catalog" }))[0].service.state,
        "inactive",
      );
      t.diagnostic(
        `${models} model calls, ${revisions} exact source revisions, 7 workshop sessions, ${ready.archivedOperations} archived receipts, ${waits.size} capacity wait reasons, one checked inactive hosted component; controlled external effects only.`,
      );
    } finally {
      release.resolve();
      await fixture.close();
    }
  },
);
