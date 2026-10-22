import assert from "node:assert/strict";
import test from "node:test";
import { generateAuthoringResponse } from "../../server/assistant/tasks/modelResponse.js";

test("truncated authoring output becomes one saved repair without forwarding private provider text", async () => {
  let calls = 0;
  await assert.rejects(
    generateAuthoringResponse(
      {
        generate: async () => {
          calls++;
          throw Object.assign(new Error("private provider details"), {
            code: "model_output_truncated",
          });
        },
      },
      {},
      new AbortController().signal,
    ),
    (error) => {
      assert.equal(error.code, "invalid_result");
      assert.equal(error.feedback.check, "authoring_output_truncated");
      assert.equal(error.feedback.proposal.text, "");
      assert.ok(
        !JSON.stringify(error.feedback).includes("private provider details"),
      );
      return true;
    },
  );
  assert.equal(calls, 1);
});

test("provider capacity and cancellation remain owned by the durable retry and claim workflow", async () => {
  for (const error of [
    Object.assign(new Error("capacity"), { status: 429 }),
    new DOMException("stopped", "AbortError"),
    new Error("offline"),
  ]) {
    await assert.rejects(
      generateAuthoringResponse(
        {
          generate: async () => {
            throw error;
          },
        },
        {},
        new AbortController().signal,
      ),
      (actual) => actual === error,
    );
  }
});
