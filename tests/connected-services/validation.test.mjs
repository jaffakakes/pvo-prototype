import test from "node:test";
import assert from "node:assert/strict";
import { runServiceStep } from "../../server/assistant/validation/cases.js";
import { fixtureNodeEffect } from "../node-runtime/fixture.mjs";
import { requireConnectionResearch } from "../../server/assistant/builder/connectionResearch.js";
import { connectedAgreement, connectedSource } from "./fixtures.mjs";

const namespace = {
  getByName: () => ({
    execute: async (value) =>
      (
        await fixtureNodeEffect(
          new Request("https://fixture.test", {
            method: "POST",
            body: JSON.stringify(value),
          }),
        )
      ).json(),
    cancel: async () => ({ ok: true }),
  }),
};
test("independent Node validation checks the requested action as well as the returned answer", async () => {
  const agreement = connectedAgreement(),
    source = connectedSource();
  const run = () =>
    runServiceStep(
      namespace,
      source,
      agreement,
      source.agreementDigest,
      0,
      { step: 0, state: null },
      { ownerId: "owner", serviceId: "service", mode: "validation" },
    );
  assert.equal((await run()).caseResult.status, "passed");
  source.files[0].content =
    'export function execute() { return { result: "Saved example", state: null }; }';
  assert.equal((await run()).caseResult.failure.code, "mismatch");
  source.files[0].content =
    'export function execute() { return { request: { connection: "invented", input: { number: 7 } } }; }';
  assert.match((await run()).caseResult.failure.detail, /connection binding/);
  source.files[0].content =
    'export function execute() { return { request: { connection: "issue", input: { number: 7 } }, state: null }; }';
  assert.match((await run()).caseResult.failure.detail, /return only/);
  source.files[0].content =
    'export function execute() { return { request: { connection: "issue", input: { number: 8 } } }; }';
  assert.deepEqual((await run()).caseResult.failure, {
    step: 0,
    code: "mismatch",
    detail:
      "Generated request differs from the independent expected account action.",
  });
  source.files[0].content =
    'export function execute() { throw Object.assign(new Error("private guest text"), {code: "account_reply_shape"}); }';
  assert.equal(
    (await run()).caseResult.failure.detail,
    "Generated code did not return a valid bounded reply.",
  );
  source.files[0].content =
    'export function execute() { return { request: { connection: "issue", input: { number: 7 } } }; }';
  delete agreement.connections;
  delete agreement.cases[0].steps[0].requests;
  assert.match((await run()).caseResult.failure.detail, /saved agreement/);
});

test("AI adapter agreements require same-task documented research and current account permissions", () => {
  const agreement = connectedAgreement(),
    task = { id: "current-task" };
  const url = agreement.connections[0].adapter.documentation.split("#")[0];
  let present = true,
    support = "documented",
    permissions = ["issues:read"];
  const coordinator = {
    connections: {
      get: () => ({ status: "connected", provider: "github", permissions }),
    },
    research: {
      get: (taskId, id) =>
        taskId === task.id && id === "read-doc"
          ? {
              settled: true,
              tool: { kind: "web_read" },
              result: { status: "completed", result: { url } },
            }
          : null,
      sql: {
        exec: (_sql, taskId, expectedUrl) => ({
          toArray: () =>
            present && taskId === task.id && expectedUrl === url
              ? [
                  {
                    body: JSON.stringify({
                      result: {
                        result: {
                          assessment: { support },
                          verification: "source_text_only",
                          source: { operationId: "read-doc" },
                        },
                      },
                    }),
                  },
                ]
              : [],
        }),
      },
    },
  };
  requireConnectionResearch(coordinator, task, agreement);
  present = false;
  assert.throws(
    () => requireConnectionResearch(coordinator, task, agreement),
    /documentation/,
  );
  present = true;
  support = "unclear";
  assert.throws(
    () => requireConnectionResearch(coordinator, task, agreement),
    /documentation/,
  );
  support = "documented";
  permissions = [];
  assert.throws(
    () => requireConnectionResearch(coordinator, task, agreement),
    /permission/,
  );
});
