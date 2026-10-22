import assert from "node:assert/strict";
import test from "node:test";
import { authoringMessages } from "../../server/assistant/tasks/promptContext.js";

const clarification = {
  prompt: "Clarify the expected recovery behavior",
  answer: {
    value: "Keep the receipt after playback or restart. Never resend.",
    answeredAt: 20,
  },
};
const context = () => ({
  input: { context: { components: [] }, examples: [] },
  questions: [
    clarification,
    {
      prompt: "Earlier answer",
      answer: { value: "Keep repairing", answeredAt: 10 },
    },
    { prompt: "Unanswered", answer: null },
  ],
  evidence: {
    repair: {
      check: "builder_response",
      message: "Receipt must match its schema",
      proposal: {
        text: '{"kind":"agreement","description":"Reset after playback and resend"}',
        truncated: false,
      },
    },
    selection: {
      collection: "repairs",
      after: 0,
      offset: 0,
      sequence: 1,
      nextOffset: null,
    },
    progress: [{ channel: "history", repetitions: 1 }],
  },
});

test("the latest answered clarification follows conflicting rejected proposals and completed history reads", () => {
  const input = context(),
    before = structuredClone(input);
  const messages = authoringMessages("Trusted instructions", input, 8192);
  const last = JSON.parse(messages.at(-1).content);
  assert.deepEqual(last.creatorClarification, {
    question: clarification.prompt,
    answer: clarification.answer.value,
  });
  assert.equal(messages.at(-1).role, "user");
  assert.ok(
    messages.some(
      (message) => message.content === input.evidence.repair.proposal.text,
    ),
  );
  assert.equal(
    JSON.parse(messages.at(-2).content).observedHistory.collection,
    "repairs",
  );
  assert.deepEqual(input, before);
});

test("clarification respects the prompt byte bound and never invents an unanswered or omitted answer", () => {
  const input = context();
  input.questions = [
    clarification,
    {
      prompt: "Old large answer",
      answer: { value: "x".repeat(60000), answeredAt: 1 },
    },
  ];
  const messages = authoringMessages("Trusted instructions", input, 4096);
  assert.ok(Buffer.byteLength(JSON.stringify(messages)) <= 4096);
  assert.equal(
    JSON.parse(messages.at(-1).content).creatorClarification.answer,
    clarification.answer.value,
  );
  assert.equal(input.questions.length, 2);
  input.questions = [{ prompt: "Unanswered", answer: null }];
  assert.ok(
    authoringMessages("Trusted instructions", input, 8192).every(
      (message) =>
        !JSON.parse(message.content.startsWith("{") ? message.content : "{}")
          .creatorClarification,
    ),
  );
});
