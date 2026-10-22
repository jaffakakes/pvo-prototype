import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { taskFixture, saved, path } from "../assistant-task-server/helpers.mjs";
import { comparisonSandbox } from "../../scripts/checks/model-comparison/sandbox.mjs";
import { isolatedTaskEffects } from "../../scripts/checks/restyle-capability/effects.mjs";
import {
  dinnerAgreement,
  dinnerSource,
} from "../service-validation/fixtures.mjs";
import { proposal } from "../service-attachments/task.helpers.mjs";

test(
  "durable evaluation uses real planners and saved repair feedback across the model transport",
  { timeout: 30000 },
  async () => {
    const requests = [];
    const fixture = await taskFixture({
      realClock: true,
      workspaces: true,
      modelFetch: async (request) => {
        assert.equal(new URL(request.url).hostname, "api.runpod.ai");
        const input = await request.json();
        requests.push(input);
        const decision =
          requests.length <= 2
            ? { kind: "build" }
            : {
                kind: "ask",
                prompt: "Which day should the event use?",
                choices: [],
                ...(requests.length === 3 ? { calls: [] } : {}),
              };
        return Response.json({
          model: "kimi-k2.6",
          choices: [
            {
              finish_reason: requests.length === 1 ? "length" : "stop",
              message: { role: "assistant", content: JSON.stringify(decision) },
            },
          ],
        });
      },
      nodeEffect: async () => {
        throw new Error("This scenario must not execute generated code.");
      },
    });
    try {
      const task = await saved(fixture);
      const deadline = Date.now() + 20000;
      let current;
      while (Date.now() < deadline) {
        current = (await fixture.request(path(task))).body.task;
        if (
          current.state === "waiting_for_answer" ||
          current.state === "failed"
        )
          break;
        await delay(100);
      }
      assert.equal(
        current.state,
        "waiting_for_answer",
        JSON.stringify(current.failure),
      );
      assert.equal(
        current.questions.at(-1).prompt,
        "Which day should the event use?",
      );
      assert.equal(requests.length, 4);
      assert.equal(current.usage.modelTurns, 4);
      assert.ok(
        requests[1].messages.some((message) =>
          message.content.includes("authoring_output_truncated"),
        ),
      );
      assert.ok(
        requests[1].messages.some((message) =>
          message.content.includes("no proposal text to retrieve"),
        ),
      );
      assert.ok(
        requests[3].messages.some((message) =>
          message.content.includes("Unsupported fields: calls"),
        ),
      );
      assert.ok(
        requests[3].messages.some((message) =>
          message.content.includes(
            '"savedSource":{"revision":0,"digest":null}',
          ),
        ),
      );
      await fixture.restart();
      const restored = (await fixture.request(path(task))).body.task;
      assert.equal(restored.state, "waiting_for_answer");
      assert.deepEqual(restored.questions, current.questions);
      assert.equal(requests.length, 4);
    } finally {
      await fixture.close();
    }
  },
);

test(
  "durable evaluation executes source and independent cases in Docker before compiling an attachment",
  { skip: process.env.RESTYLE_MODEL_SANDBOX !== "1", timeout: 60000 },
  async () => {
    const resources = new Map();
    const sandbox = await comparisonSandbox(async (resource) =>
      resources.set(resource.name, resource),
    );
    let calls = 0;
    const fixture = await taskFixture({
      realClock: true,
      workspaces: true,
      services: true,
      ...isolatedTaskEffects(sandbox),
      modelFetch: async (request) => {
        const wire = await request.json();
        const context = wire.messages
          .map((message) => {
            try {
              return JSON.parse(message.content);
            } catch {
              return null;
            }
          })
          .find((value) => value?.input);
        calls++;
        let decision;
        if (context.service)
          decision = proposal({ attachmentContext: context.service });
        else if (!context.build) decision = { kind: "build" };
        else if (!context.build.agreement)
          decision = {
            kind: "agreement",
            agreement: dinnerAgreement(),
          };
        else if (!context.build.source.revision)
          decision = {
            kind: "tools",
            review: null,
            calls: [
              {
                kind: "workspace_write",
                expectedRevision: 0,
                files: [
                  { path: "src/service.mjs", content: dinnerSource },
                  {
                    path: "tests/service.test.mjs",
                    content:
                      "import {execute} from '../src/service.mjs'; import assert from 'node:assert/strict'; assert.equal(execute({operation:'join',input:{name:'Ari'},state:{capacity:1,guests:[]}}).result,'accepted');",
                  },
                ],
              },
            ],
          };
        else {
          const reference = context.build.source;
          decision = {
            kind: "tools",
            calls: [
              { kind: "workspace_start", ...reference },
              {
                kind: "workspace_test",
                ...reference,
                paths: ["tests/service.test.mjs"],
              },
            ],
            review: {
              kind: "review",
              ...reference,
              entrypoint: "src/service.mjs",
              tests: ["tests/service.test.mjs"],
              libraries: [],
            },
          };
        }
        return Response.json({
          model: "kimi-k2.6",
          choices: [
            {
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: JSON.stringify(decision),
              },
            },
          ],
        });
      },
    });
    try {
      const task = await saved(fixture);
      const deadline = Date.now() + 45000;
      let current;
      while (Date.now() < deadline) {
        current = (await fixture.request(path(task))).body.task;
        if (["ready", "failed", "waiting_for_answer"].includes(current.state))
          break;
        await delay(100);
      }
      assert.equal(
        current.state,
        "ready",
        JSON.stringify(current.failure ?? current.questions),
      );
      assert.equal(calls, 5);
      const result = await fixture.request(path(task) + "/result");
      assert.equal(result.status, 200);
      assert.equal(result.body.attachment.receipt.readiness.state, "available");
      await fixture.restart();
      assert.deepEqual(
        (await fixture.request(path(task) + "/result")).body,
        result.body,
      );
    } finally {
      await fixture.close();
      assert.ok(resources.size > 0);
      assert.ok([...resources.values()].every((resource) => resource.cleaned));
    }
  },
);
