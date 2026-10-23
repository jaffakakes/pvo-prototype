import test from "node:test";
import assert from "node:assert/strict";
import {
  parseDraftDecision,
  prepareDraftEdit,
  readDraftFile,
} from "../../server/assistant/drafts/decisions.js";
import { planDraftEdit } from "../../server/assistant/drafts/planner.js";
import { create, claim } from "../assistant-tasks/fixtures.mjs";

test("bounded Unicode reads and revision-checked exact edits preserve the rest of a large file", () => {
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
    oldText: "🧪",
    newText: "CHECK",
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
    prepareDraftEdit(
      saved,
      { ...decision, oldText: "missing text" },
      "outside",
    ),
  );
  assert.throws(
    () => prepareDraftEdit(saved, { ...decision, oldText: "aa" }, "ambiguous"),
    /more than once/,
  );
  assert.throws(() => parseDraftDecision({ ...decision, oldText: "" }));
  assert.throws(() =>
    parseDraftDecision({
      kind: "replace",
      expectedRevision: 12,
      path: file.path,
      start: 0,
      end: 1,
      content: "old shape",
    }),
  );
  assert.throws(() => parseDraftDecision({ ...decision, publish: true }));
  assert.throws(() =>
    parseDraftDecision({ ...decision, path: "src/../secret.mjs" }),
  );
});

test("identical AI edits cannot advance a saved revision; a real metadata edit remains possible", () => {
  const file = { path: "src/main.mjs", content: "export const value = '🧪';" };
  const saved = {
    draft: {
      revision: 3,
      content: {
        description: "Saved draft",
        files: [
          file,
          { path: "tests/main.test.mjs", content: "// selected later" },
        ],
        entrypoint: file.path,
        tests: [],
        agreement: null,
        dependencies: [],
      },
    },
  };
  const replace = {
    kind: "replace",
    expectedRevision: 3,
    path: file.path,
    oldText: file.content,
    newText: file.content,
  };
  assert.throws(
    () => prepareDraftEdit(saved, replace, "same-source"),
    /already saved/,
  );
  assert.throws(
    () =>
      prepareDraftEdit(
        saved,
        { ...replace, oldText: "export", newText: "export" },
        "empty-insertion",
      ),
    /already saved/,
  );
  const write = {
    kind: "write",
    expectedRevision: 3,
    files: [file],
    entrypoint: file.path,
    tests: [],
    libraries: [],
    agreementJson: "null",
  };
  assert.throws(
    () => prepareDraftEdit(saved, write, "same-package"),
    /already saved/,
  );
  const changed = prepareDraftEdit(
    saved,
    { ...write, tests: ["tests/main.test.mjs"] },
    "select-test",
  );
  assert.deepEqual(changed.content.tests, ["tests/main.test.mjs"]);
  assert.deepEqual(changed.content.files, saved.draft.content.files);
  assert.equal(saved.draft.revision, 3);
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
  // Requested behavior changes must be allowed to update expectations; repairs keep theirs frozen.
  await planDraftEdit(task, {}, env, new AbortController().signal, null, {
    generate: async ({ messages }) => {
      assert.match(
        messages[0].content,
        /Update the selected source tests and behavior agreement/,
      );
      assert.doesNotMatch(
        messages[0].content,
        /Preserve the original agreement/,
      );
      return { content: { kind: "done" } };
    },
  });
  await planDraftEdit(
    {
      ...task,
      input: {
        ...task.input,
        context: {
          ...task.input.context,
          container: { ...task.input.context.container, mode: "repair" },
        },
      },
    },
    {},
    env,
    new AbortController().signal,
    null,
    {
      generate: async ({ messages }) => {
        assert.match(
          messages[0].content,
          /Preserve the original agreement and independent cases/,
        );
        assert.match(messages[0].content, /Diagnose with exact evidenceKeys/);
        return { content: { kind: "done" } };
      },
    },
  );
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
