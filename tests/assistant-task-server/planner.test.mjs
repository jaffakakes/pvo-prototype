import assert from "node:assert/strict";
import test from "node:test";
import {
  planSavedTask,
  savedPlannerAvailable,
} from "../../server/assistant/tasks/planner.js";
import { create, claim } from "../assistant-tasks/fixtures.mjs";

const signal = () => new AbortController().signal;
function provider(response, extra = {}) {
  const calls = [];
  return {
    calls,
    env: {
      ASSISTANT_PROVIDER: "cloudflare",
      ASSISTANT_BUDGET: {},
      AI: {
        async run(model, input) {
          calls.push({ model, input });
          return { response, ...extra };
        },
      },
      SESSION_SECRET: "private-platform-value",
      CLOUDFLARE_API_TOKEN: "private-control-value",
    },
  };
}

test("the saved planner uses bounded task context and saved questions without platform credentials", async () => {
  const mock = provider({
    kind: "ask",
    prompt: "Which date?",
    choices: ["Friday", "Saturday"],
  });
  const task = claim(create());
  assert.equal(savedPlannerAvailable(mock.env), true);
  assert.equal(
    savedPlannerAvailable({ ...mock.env, ASSISTANT_BUDGET: undefined }),
    false,
  );
  const command = await planSavedTask(task, mock.env, signal());
  assert.equal(command.kind, "ask");
  assert.equal(command.question.id, "question-1");
  assert.equal(command.question.answer, null);
  const sent = JSON.stringify(mock.calls);
  assert.ok(sent.includes(task.input.request));
  assert.ok(!sent.includes("private-platform-value"));
  assert.ok(!sent.includes("private-control-value"));
  assert.equal(mock.calls.length, 1);
  assert.deepEqual(
    await planSavedTask(
      task,
      provider(JSON.stringify({ kind: "build" })).env,
      signal(),
    ),
    { kind: "checkpoint", stepId: "build" },
  );
});

test("planning cannot emit provider actions, invented receipts, oversize questions or malformed suggestions", async () => {
  const task = claim(create());
  for (const output of [
    { kind: "complete", result: { artifact: "invented" } },
    { kind: "build", url: "https://invented.example" },
    { kind: "ask", prompt: "x".repeat(2001), choices: [] },
    { kind: "ask", prompt: "date", choices: Array(7).fill("choice") },
    { kind: "ask", prompt: "date", choices: ["Friday", "Friday"] },
    { kind: "ask", prompt: "date", choices: [], ownerId: "someone" },
    "x".repeat(8193),
    "not JSON",
  ])
    await assert.rejects(
      planSavedTask(task, provider(output).env, signal()),
      (error) => error.code === "invalid_result",
    );
  await assert.rejects(
    planSavedTask(
      task,
      provider({ kind: "build" }, { tool_calls: [{ name: "deploy" }] }).env,
      signal(),
    ),
    (error) => error.code === "invalid_result",
  );
});
