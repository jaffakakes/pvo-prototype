import assert from "node:assert/strict";
import test from "node:test";
import {
  BUILDER_TOOL_KINDS,
  builderToolDefinitions,
  readBuilderWorkspace,
} from "../../packages/pvo-assistant/builder/index.js";
import { planSavedBuild } from "../../server/assistant/builder/planner.js";
import {
  workspaceFixture,
  identity,
  files,
} from "../assistant-workspaces/helpers.mjs";
import { create, claim } from "../assistant-tasks/fixtures.mjs";
import { dinnerAgreement } from "../service-packages/fixtures.mjs";

const definitions = builderToolDefinitions(BUILDER_TOOL_KINDS);
const source = { revision: 1, digest: "a".repeat(64) };
const review = {
  kind: "review",
  entrypoint: "src/service.mjs",
  tests: ["tests/service.test.mjs"],
  libraries: [],
};
const batch = (calls, request = null) => ({
  kind: "tools",
  calls,
  review: request,
});
async function plan(decision, snapshot = source, inspect = () => {}) {
  const context = {
    agreement: dinnerAgreement(),
    source: snapshot,
    feedback: [],
  };
  return planSavedBuild(
    claim(create()),
    context,
    definitions,
    {},
    AbortSignal.timeout(1000),
    null,
    {
      generate: async (request) => {
        inspect(request, context);
        return { content: JSON.stringify(decision) };
      },
    },
  );
}

test("the model chooses actions while the host binds the source before inference", async () => {
  const current = structuredClone(source);
  const output = await plan(
    batch(
      [
        { kind: "workspace_start" },
        { kind: "workspace_check", path: "src/service.mjs" },
        { kind: "workspace_test", paths: ["tests/service.test.mjs"] },
      ],
      review,
    ),
    current,
    (request, context) => {
      for (const shape of request.schema.anyOf) {
        if (shape.properties.kind?.const === "review") {
          assert.equal("revision" in shape.properties, false);
          assert.equal("digest" in shape.properties, false);
        }
      }
      const tools = JSON.parse(request.messages[1].content).tools;
      for (const tool of tools) {
        for (const field of ["revision", "digest", "expectedRevision"])
          assert.equal(field in tool.schema.properties, false);
      }
      // An edit while the provider runs cannot silently retarget the resulting command.
      context.source.revision = 2;
      context.source.digest = "b".repeat(64);
    },
  );
  for (const command of [...output.calls, output.review]) {
    assert.equal(command.revision, 1);
    assert.equal(command.digest, source.digest);
  }
  assert.equal(current.revision, 2);
  const write = await plan(
    batch([{ kind: "workspace_write", files: files() }]),
    { revision: 0, digest: null },
  );
  assert.equal(write.calls[0].expectedRevision, 0);
  assert.deepEqual(await plan(review), { ...review, ...source });
});

test("model-supplied fences, unsafe actions and dependent writes are rejected, not silently repaired", async () => {
  for (const decision of [
    { ...review, revision: 1 },
    { ...review, digest: source.digest },
    batch([{ kind: "workspace_write", expectedRevision: 1, files: files() }]),
    batch([{ kind: "workspace_start", revision: 1, digest: source.digest }]),
    batch([{ kind: "workspace_read", path: "../private.mjs", offset: 0 }]),
    batch([
      {
        kind: "workspace_test",
        paths: ["tests/service.test.mjs"],
        ownerId: "other",
      },
    ]),
    batch([
      { kind: "workspace_write", files: files() },
      { kind: "workspace_start" },
    ]),
    batch([{ kind: "workspace_write", files: files() }], review),
    { ...review, passed: true },
  ])
    await assert.rejects(plan(decision), { code: "invalid_result" });
  await assert.rejects(plan(review, { revision: 0, digest: null }), (error) =>
    error.feedback.message.includes("Save source before"),
  );
  await assert.rejects(plan(review, null), { code: "invalid_result" });
});

test(
  "bound model commands retain real workspace concurrency fences and receipt replay",
  { timeout: 15000 },
  async () => {
    const fixture = await workspaceFixture();
    const owned = await identity();
    try {
      const saved = await fixture.call("save", owned, {
        id: "first",
        expectedRevision: 0,
        files: files(),
      });
      assert.equal(saved.status, 200);
      const snapshot = saved.result.result;
      const pending = await plan(
        batch([
          {
            kind: "workspace_write",
            files: files().map((file) => ({
              ...file,
              content: file.content + "\n// updated",
            })),
          },
        ]),
        snapshot,
      );
      const start = await plan(batch([{ kind: "workspace_start" }]), snapshot);
      const read = await plan(
        batch([{ kind: "workspace_read", path: "src/service.mjs", offset: 0 }]),
        snapshot,
      );
      const changed = await fixture.call("save", owned, {
        id: "manual",
        expectedRevision: 1,
        files: files().map((file) => ({
          ...file,
          content: file.content + "\n// manual",
        })),
      });
      assert.equal(changed.status, 200);
      const { kind: writeKind, ...write } = pending.calls[0];
      const staleWrite = await fixture.call("save", owned, {
        id: "stale",
        ...write,
      });
      assert.notEqual(staleWrite.status, 200);
      const { kind: startKind, ...startInput } = start.calls[0];
      const staleStart = await fixture.call("start", owned, {
        id: "stale-start",
        ...startInput,
      });
      assert.notEqual(staleStart.status, 200);
      const current = (await fixture.call("lookup", owned)).result.source;
      assert.equal(current.revision, 2);
      assert.throws(() => readBuilderWorkspace(current, read.calls[0]));
      const replay = await fixture.call("save", owned, {
        id: "manual",
        expectedRevision: 1,
        files: files().map((file) => ({
          ...file,
          content: file.content + "\n// manual",
        })),
      });
      assert.deepEqual(replay, changed);
      assert.equal(
        (await fixture.call("lookup", owned)).result.source.revision,
        2,
      );
    } finally {
      await fixture.close();
    }
  },
);
