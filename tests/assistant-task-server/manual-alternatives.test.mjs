import assert from "node:assert/strict";
import test from "node:test";
import {
  manualFixture,
  untilQuestion,
  answerAlternative,
  finishManualPreparation,
} from "./manual-alternatives.fixture.mjs";
import { path, expectStatus, NOW } from "./helpers.mjs";
import { current } from "./provider.helpers.mjs";
import {
  TASK_LIMITS,
  manualFieldLabel,
} from "../../packages/pvo-assistant/tasks/index.js";

async function start(f, request = "Reserve a table") {
  const project = await f.project();
  const created = await f.create(project.body.project.id, {
    request,
    examples: [],
  });
  expectStatus(created, 201);
  return untilQuestion(f, created.body.task);
}
test(
  "real saved runner proposes distinct outcomes, preserves changed intent and saves explicit choice before building",
  { timeout: 60000 },
  async () => {
    for (const [request, preparedOutcome, limitation] of [
      [
        "Reserve a table",
        "Gather preferences for a telephone booking",
        "Calling is unavailable",
      ],
      [
        "Submit a grant application",
        "Prepare application details for you to submit",
        "This fund accepts applications only through its private portal",
      ],
      [
        "Inspect an unfamiliar river gauge",
        "Prepare a visit checklist",
        "Automatic readings are not documented",
      ],
    ]) {
      const f = await manualFixture({
        sample: { preparedOutcome, limitation },
      });
      try {
        let task = await start(f, request);
        assert.equal(task.questions[0].alternative.originalOutcome, request);
        assert.equal(
          task.questions[0].alternative.preparedOutcome,
          preparedOutcome,
        );
        assert.deepEqual(task.manualPlans, []);
        task = await answerAlternative(
          f,
          task,
          "Actually collect information only, without messaging anyone",
        );
        assert.deepEqual(task.manualPlans, []);
        task = await untilQuestion(f, task);
        assert.equal(
          task.questions.at(-1).alternative.preparedOutcome,
          "Collect preferences without sending messages",
        );
        task = await answerAlternative(f, task);
        assert.equal(task.manualPlans.length, 1);
        await f.restart();
        await f.control({ action: "time", now: NOW });
        const restored = await current(f, task);
        assert.deepEqual(restored.manualPlans, task.manualPlans);
        assert.equal(
          restored.questions[0].answer.value,
          "Actually collect information only, without messaging anyone",
        );
        assert.equal(restored.input.request, request);
      } finally {
        await f.close();
      }
    }
  },
);

test(
  "checked hosting and compilation leave human work pending; private resolution and retention survive restart",
  { timeout: 30000 },
  async () => {
    const f = await manualFixture();
    try {
      let task = await answerAlternative(f, await start(f));
      task = await finishManualPreparation(f, task);
      assert.equal(task.expiresAt, null);
      assert.equal(task.manualPlans[0].steps[0].resolution, null);
      const artifact = await f.request(path(task) + "/result");
      expectStatus(artifact, 200);
      assert.ok(
        artifact.body.operations[0].source.structure.includes(
          manualFieldLabel(task.manualPlans[0].proposal.fields[0]),
        ),
      );
      assert.ok(
        artifact.body.operations[0].source.structure.includes(
          task.manualPlans[0].proposal.notice,
        ),
      );
      await f.restart();
      await f.control({ action: "time", now: NOW + 40 * 86400000 });
      await f.control({ action: "sweep" });
      task = await current(f, task);
      assert.equal(task.manualPlans[0].steps[0].resolution, null);
      const body = {
        expectedRevision: task.revision,
        questionId: task.manualPlans[0].questionId,
        stepId: "book",
        operationId: "human-booking",
        status: "completed",
        note: "Called and received the venue confirmation.",
      };
      expectStatus(
        await f.request(path(task) + "/manual", {
          body,
          session: f.otherCookie,
        }),
        404,
      );
      expectStatus(
        await f.request(path(task) + "/manual", {
          body,
          headers: { Origin: "https://elsewhere.invalid" },
        }),
        403,
      );
      expectStatus(
        await f.request(path(task) + "/manual", {
          body: { ...body, expectedRevision: task.revision - 1 },
        }),
        409,
      );
      expectStatus(
        await f.request(path(task) + "/manual", {
          body: { ...body, completedByModel: true },
        }),
        400,
      );
      let response = await f.request(path(task) + "/manual", { body });
      expectStatus(response, 200);
      task = response.body.task;
      assert.equal(task.manualPlans[0].steps[0].resolution.status, "completed");
      assert.equal(
        task.expiresAt,
        NOW + 40 * 86400000 + TASK_LIMITS.retentionMs,
      );
      response = await f.request(path(task) + "/manual", {
        body: { ...body, expectedRevision: task.revision },
      });
      expectStatus(response, 200);
      assert.equal(response.body.task.revision, task.revision);
      await f.restart();
      await f.control({ action: "time", now: task.expiresAt });
      await f.control({ action: "sweep" });
      expectStatus(await f.request(path(task)), 404);
    } finally {
      await f.close();
    }
  },
);

test(
  "forged research references and ignored form commitments are rejected before a ready result",
  { timeout: 30000 },
  async () => {
    const { manualPlanner } = await import("./manual-alternatives.fixture.mjs");
    const repairs = [];
    let forged = false,
      badNotice = false,
      badPurpose = false;
    const f = await manualFixture({
      planner: async (request) => {
        const task = await request.json();
        if (task.evidenceContext.repair)
          repairs.push(task.evidenceContext.repair);
        const proposed = manualPlanner(task);
        if (proposed.kind === "manual_alternative" && !forged) {
          forged = true;
          proposed.proposal.capabilityId = "another-task-receipt";
        }
        if (task.stepId === "attach" && !badNotice) {
          badNotice = true;
          proposed.component.source.structure =
            proposed.component.source.structure.replace(
              task.manualPlans[0].proposal.notice,
              "Your table is confirmed",
            );
        } else if (task.stepId === "attach" && !badPurpose) {
          badPurpose = true;
          proposed.component.source.structure =
            proposed.component.source.structure.replace(
              manualFieldLabel(task.manualPlans[0].proposal.fields[0]),
              "Name",
            );
        }
        return Response.json(proposed);
      },
    });
    try {
      const chosen = await answerAlternative(f, await start(f));
      const ready = await finishManualPreparation(f, chosen);
      assert.equal(ready.manualPlans[0].steps[0].resolution, null);
      assert.ok(
        repairs.some((item) => item.message.includes("current capability")),
      );
      assert.ok(
        repairs.some((item) => item.message.includes("pending-action notice")),
      );
      assert.ok(
        repairs.some((item) => item.message.includes("visible data purposes")),
      );
      assert.equal((await f.control({ action: "results" })).body.count, 1);
    } finally {
      await f.close();
    }
  },
);
