import { setTimeout as delay } from "node:timers/promises";
import {
  dinnerAgreement,
  dinnerSource,
  packageFor,
} from "../service-validation/fixtures.mjs";
import assert from "node:assert/strict";
import { taskFixture, NOW, path, expectStatus } from "./helpers.mjs";
import { current } from "./provider.helpers.mjs";
import { alternative } from "../assistant-tasks/manual.fixture.mjs";
import { proposal as attachment } from "../service-attachments/task.helpers.mjs";
import { manualFieldLabel } from "../../packages/pvo-assistant/tasks/index.js";

export function manualPlanner(task, overrides = {}) {
  const sample = alternative({
    originalOutcome: task.input.request,
    ...overrides,
  });
  if (task.stepId === "plan") return { kind: "checkpoint", stepId: "build" };
  if (task.stepId === "attach") {
    const command = attachment(task),
      plan = task.manualPlans[0].proposal;
    command.component.sceneId = task.input.context.currentSceneId;
    const escape = (text) =>
      text
        .replaceAll("&", "&amp;")
        .replaceAll('"', "&quot;")
        .replaceAll("<", "&lt;");
    command.component.source.structure = `<form><heading>${escape(plan.notice)}</heading>${plan.fields.map((field) => `<field name="${field.name}" kind="${field.kind}" label="${escape(manualFieldLabel(field))}"/>`).join("")}<submit>Save preference</submit></form>`;
    return command;
  }
  const feedback = task.builderContext.feedback;
  if (task.manualPlans.length) {
    if (!task.builderContext.agreement)
      return {
        kind: "agreement",
        agreement: {
          ...JSON.parse(
            JSON.stringify(dinnerAgreement()).replaceAll(
              '"accepted"',
              '"saved_for_manual_followup"',
            ),
          ),
          description: task.manualPlans[0].proposal.preparedOutcome,
        },
      };
    const write = feedback.find(
      (item) =>
        item.kind === "workspace_write" && item.result.status === "completed",
    );
    if (!write)
      return {
        kind: "tools",
        review: null,
        calls: [
          {
            kind: "workspace_write",
            expectedRevision: 0,
            files: packageFor(
              dinnerSource.replaceAll(
                "'accepted'",
                "'saved_for_manual_followup'",
              ),
            ).files,
          },
        ],
      };
    return {
      kind: "review",
      libraries: [],
      ...write.result.result,
      entrypoint: "src/service.mjs",
      tests: ["tests/service.test.mjs"],
    };
  }
  const connections = feedback.find((item) => item.kind === "connections_read");
  if (!connections)
    return {
      kind: "research",
      calls: [{ kind: "connections_read", after: null }],
    };
  const capability = task.evidenceContext.capabilities.decisions.find(
    (item) => item.current,
  );
  if (!capability)
    return {
      kind: "research",
      calls: [
        {
          kind: "capability_record",
          key: "original-operation",
          operation: sample.originalOutcome,
          outcome: sample.preparedOutcome,
          selection: "proposed",
          status: "unverified",
          reason: sample.limitation,
          answerQuestionId: null,
          basis: {
            type: "external",
            evidenceIds: [],
            connectionReadId: connections.operationId,
            connectionId: null,
            adapterOperation: null,
            permissions: [],
          },
        },
      ],
    };
  const changed = task.questions.some((question) => question.answer);
  return {
    kind: "manual_alternative",
    proposal: {
      ...sample,
      capabilityId: capability.operationId,
      ...(changed
        ? {
            preparedOutcome: "Collect preferences without sending messages",
            limitation:
              "Your changed request only asks for information collection.",
          }
        : {}),
    },
  };
}
export async function manualFixture(options = {}) {
  return taskFixture({
    services: true,
    workspaces: true,
    clock: NOW,
    productionLeases: true,
    planner: async (request) =>
      Response.json(manualPlanner(await request.json(), options.sample)),
    ...options,
  });
}
export async function untilQuestion(fixture, task) {
  for (let index = 0; index < 15; index++) {
    task = await current(fixture, task);
    if (task.state === "waiting_for_answer") return task;
    expectStatus(await fixture.control({ action: "sweep" }), 200);
  }
  assert.fail(`No question: ${JSON.stringify(task)}`);
}
/** Controlled model/source; real saved runner, independent comparison, local hosting and compiler. */
export async function finishManualPreparation(fixture, task) {
  for (let index = 0; index < 150; index++) {
    task = await current(fixture, task);
    if (task.state === "ready") return task;
    if (task.state === "running") {
      await delay(100);
      continue;
    }
    expectStatus(await fixture.control({ action: "sweep" }), 200);
  }
  assert.fail(`Preparation did not finish: ${JSON.stringify(task)}`);
}
export async function answerAlternative(
  fixture,
  task,
  value = "Use this alternative",
) {
  const question = task.questions.find((item) => !item.answer);
  const response = await fixture.request(path(task) + "/answers", {
    body: {
      expectedRevision: task.revision,
      questionId: question.id,
      questionRevision: 0,
      operationId: `answer-${question.id}`,
      value,
    },
  });
  expectStatus(response, 200);
  return response.body.task;
}
