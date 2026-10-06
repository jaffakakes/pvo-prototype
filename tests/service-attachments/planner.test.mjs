import assert from "node:assert/strict";
import test from "node:test";
import { withEvidenceSchema } from "../../server/assistant/tasks/evidenceInput.js";
import { planTaskAttachment } from "../../server/assistant/attachments/planner.js";
import { serviceAttachmentSchema } from "../../packages/pvo-assistant/attachments/index.js";
import { create } from "../assistant-tasks/fixtures.mjs";
import { attachment } from "./fixtures.mjs";
const context = {
  releaseId: "release-one",
  url: "https://restyle.example/api/services/service-one/actions",
  operations: [],
};

test("attachment inference uses only the bounded command schema and supplied public context", async () => {
  const proposed = attachment("release-one");
  let calls = 0;
  const result = await planTaskAttachment(
    create(),
    context,
    {
      AI: {
        async run(model, request) {
          calls++;
          assert.deepEqual(
            request.response_format.json_schema,
            withEvidenceSchema(serviceAttachmentSchema),
          );
          assert.equal(request.max_tokens, 6000);
          const payload = JSON.parse(request.messages[1].content);
          assert.deepEqual(payload.service, context);
          assert.equal(payload.context.currentSceneId, "scene-one");
          assert.equal(Object.hasOwn(payload, "receipt"), false);
          return { response: JSON.stringify(proposed) };
        },
      },
    },
    new AbortController().signal,
  );
  assert.deepEqual(result, proposed);
  assert.equal(calls, 1);
});

test("attachment inference rejects model tools, malformed JSON, oversized source and model-supplied authority", async () => {
  for (const response of [
    { response: "not-json" },
    { response: attachment("release-one"), tool_calls: [{ name: "deploy" }] },
    { response: { ...attachment("release-one"), receipt: { ready: true } } },
    { response: "x".repeat(128 * 1024 + 1) },
  ])
    await assert.rejects(
      planTaskAttachment(
        create(),
        context,
        { AI: { run: async () => response } },
        new AbortController().signal,
      ),
      { code: "invalid_result" },
    );
});
