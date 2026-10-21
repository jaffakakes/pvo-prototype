import assert from "node:assert/strict";
import test from "node:test";
import { parseNativeTurnRequest } from "../packages/pvo-assistant/native/index.js";
import { nativeAssistantTurn } from "../server/assistant/native/service.js";
import { inspectNativeAttachments } from "../server/assistant/native/attachments.js";
import { validateNativeInput } from "../server/assistant/native/policy.js";
import { nativeInput } from "./native-assistant-server.helpers.mjs";

const image = {
  kind: "image",
  name: "reference.png",
  dataUrl: "data:image/png;base64,aGVsbG8=",
};
const text = {
  kind: "text",
  name: "brief.md",
  text: "Use pink buttons and the heading Join us.",
};

test("attachments reject remote images, unsupported shapes and excessive counts before inference", () => {
  for (const attachments of [
    [{ ...image, dataUrl: "https://example.com/private.png" }],
    [{ ...text, kind: "pdf" }],
    [text, text, text, text],
    [{ ...text, text: "x".repeat(16001) }],
  ]) {
    assert.throws(() =>
      parseNativeTurnRequest({ ...nativeInput(), attachments }),
    );
  }
  const request = parseNativeTurnRequest({
    ...nativeInput(),
    attachments: [image, text],
  });
  validateNativeInput(request);
  assert.equal(request.attachments.length, 2);
});

test("the planner receives attachment content, not raw images, and retains bounded reference evidence", async () => {
  const seen = [];
  const request = parseNativeTurnRequest({
    ...nativeInput(),
    mode: "ask",
    prompt: "Describe these references.",
    attachments: [image, text],
  });
  const result = await nativeAssistantTurn(request, {
    signal: new AbortController().signal,
    models: {
      frameAttemptMs: 1000,
      textAttemptMs: 1000,
      describeFrame: async ({ image: bytes, question }) => {
        assert.equal(bytes, image.dataUrl);
        assert.match(question, /not a video frame/);
        return "A pink button with rounded corners.";
      },
      generate: async ({ messages }) => {
        seen.push(messages);
        return {
          content: {
            message: "The references use pink rounded buttons.",
            operations: [],
            observations: [],
          },
        };
      },
    },
  });
  assert.match(JSON.stringify(seen), /pink button with rounded corners/);
  assert.match(JSON.stringify(seen), /Join us/);
  assert.doesNotMatch(JSON.stringify(seen), /data:image/);
  assert.equal(result.attachmentEvidence.length, 2);
  assert(result.attachmentEvidence.every((item) => item.length <= 2000));
});

test("Stop cancels image reading and never starts another attachment", async () => {
  const controller = new AbortController();
  let calls = 0;
  const task = inspectNativeAttachments(
    { ...nativeInput(), attachments: [image, image] },
    {
      signal: controller.signal,
      models: {
        frameAttemptMs: 10000,
        describeFrame: (_, signal) => {
          calls++;
          return new Promise((resolve, reject) =>
            signal.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            }),
          );
        },
      },
    },
  );
  await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  await assert.rejects(task);
  assert.equal(calls, 1);
});
