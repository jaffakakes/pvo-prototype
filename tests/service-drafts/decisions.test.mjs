import test from "node:test";
import assert from "node:assert/strict";
import {
  parseDraftDecision,
  prepareDraftEdit,
  readDraftFile,
} from "../../server/assistant/drafts/decisions.js";
import { planDraftEdit } from "../../server/assistant/drafts/planner.js";
import { create, claim } from "../assistant-tasks/fixtures.mjs";

test("bounded Unicode reads and revision-checked range edits preserve the rest of a large file", () => {
  const file = {
    path: "src/main.mjs",
    content: "a".repeat(4094) + "🧪" + "z".repeat(70000),
  };
  const saved = {
    draft: {
      revision: 12,
      content: {
        description: "Large manual file",
        agreement: null,
        entrypoint: file.path,
        tests: [],
        dependencies: [],
        files: [file, { path: "src/other.mjs", content: "// keep me" }],
      },
    },
  };
  const first = readDraftFile(saved, file.path, 0);
  assert.equal(first.nextOffset, 4094);
  const second = readDraftFile(saved, file.path, first.nextOffset);
  assert.equal(second.content.startsWith("🧪z"), true);
  const decision = parseDraftDecision({
    kind: "replace",
    expectedRevision: 12,
    path: file.path,
    start: 4094,
    end: 4095,
    content: "CHECK",
  });
  const edited = prepareDraftEdit(saved, decision, "edit-one");
  assert.equal(
    edited.content.files[0].content,
    "a".repeat(4094) + "CHECK" + "z".repeat(70000),
  );
  assert.deepEqual(edited.content.files[1], saved.draft.content.files[1]);
  assert.throws(() =>
    prepareDraftEdit(saved, { ...decision, expectedRevision: 11 }, "stale"),
  );
  assert.throws(() =>
    prepareDraftEdit(saved, { ...decision, end: 128 * 1024 }, "outside"),
  );
  assert.throws(() => parseDraftDecision({ ...decision, publish: true }));
  assert.throws(() =>
    parseDraftDecision({ ...decision, path: "src/../secret.mjs" }),
  );
});

test("draft planning uses the native content protocol and rejects invented tools or release authority", async () => {
  const task = claim(create());
  task.input.context = {
    fingerprint: "draft-1",
    container: {
      serviceId: "service-" + "a".repeat(64),
      revision: 1,
      mode: "edit",
    },
  };
  const env = {
    ASSISTANT_PROVIDER: "cloudflare",
    ASSISTANT_BUDGET: {},
    SESSION_SECRET: "private-test-secret",
    AI: {
      run: async (_model, input) => {
        assert.equal(
          JSON.stringify(input).includes("private-test-secret"),
          false,
        );
        return { response: JSON.stringify({ kind: "done" }) };
      },
    },
  };
  const result = await planDraftEdit(
    task,
    { revision: 1, files: [], read: null },
    env,
    new AbortController().signal,
    null,
  );
  assert.deepEqual(result, { kind: "done" });
  for (const response of [
    { content: { kind: "done", published: true } },
    { content: { kind: "done" }, toolCalls: [{ name: "publish" }] },
  ])
    await assert.rejects(
      () =>
        planDraftEdit(task, {}, env, new AbortController().signal, null, {
          generate: async () => response,
        }),
      /./,
    );
});
