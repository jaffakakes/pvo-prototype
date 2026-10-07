import assert from "node:assert/strict";
import test from "node:test";
import {
  BUILDER_TOOL_KINDS,
  BUILDER_TOOL_LIMITS,
  parseBuilderTool,
  readBuilderWorkspace,
  builderToolDefinitions,
} from "../../packages/pvo-assistant/builder/index.js";
import { createWorkspaceTools } from "../../server/assistant/builder/workspaceTools.js";
import {
  workspaceFixture,
  identity,
  files,
} from "../assistant-workspaces/helpers.mjs";
const digest = "d".repeat(64);

test("model tool inputs exclude ownership, grants, credentials, arbitrary commands and unsafe files", () => {
  const input = {
    kind: "workspace_write",
    expectedRevision: 0,
    files: files(),
  };
  assert.deepEqual(parseBuilderTool(input), input);
  for (const field of [
    "id",
    "ownerId",
    "projectId",
    "taskId",
    "grant",
    "env",
    "shell",
    "passed",
  ])
    assert.throws(() => parseBuilderTool({ ...input, [field]: "malicious" }));
  for (const value of [
    { kind: "workspace_shell", command: "id" },
    { kind: "workspace_read", revision: 1, path: "../secret.mjs", offset: 0 },
    { kind: "workspace_read", revision: 0, path: "src/service.mjs", offset: 0 },
    {
      kind: "workspace_read",
      revision: 1,
      path: "src/service.mjs",
      offset: -1,
    },
    { kind: "workspace_start", revision: 1, digest: "bad" },
    { kind: "workspace_test", revision: 1, digest, paths: ["src/service.mjs"] },
    { kind: "workspace_test", revision: 1, digest, paths: [] },
    {
      kind: "workspace_test",
      revision: 1,
      digest,
      paths: ["tests/a.mjs", "tests/a.mjs"],
    },
    { kind: "workspace_result", operationId: "../foreign" },
  ])
    assert.throws(() => parseBuilderTool(value));
  let accessed = false;
  assert.throws(() =>
    parseBuilderTool({
      get kind() {
        accessed = true;
        return "workspace_list";
      },
    }),
  );
  assert.equal(accessed, false);
});

test("rejected tool inputs identify their exact allowed fields without exposing values", () => {
  const input = {
    kind: "workspace_read",
    revision: 1,
    path: "src/service.mjs",
    offset: 0,
  };
  assert.deepEqual(parseBuilderTool(input), input);
  assert.throws(
    () => parseBuilderTool({ ...input, digest: "private-value" }),
    (error) => {
      assert.match(
        error.message,
        /workspace_read \(exact fields: kind, revision, path, offset\)/,
      );
      assert.doesNotMatch(error.message, /private-value/);
      return true;
    },
  );
  assert.throws(
    () => parseBuilderTool({ kind: "history", collection: "repairs" }),
    /Workspace tool is unsupported/,
  );
});

test("file feedback is bounded, Unicode-safe, revision-specific and contains only declared source", () => {
  const content = "🙂é".repeat(3000);
  const source = {
    revision: 1,
    digest,
    files: [{ path: "src/service.mjs", content }],
  };
  const listing = readBuilderWorkspace(source, { kind: "workspace_list" });
  assert.deepEqual(listing, {
    revision: 1,
    digest,
    files: [{ path: "src/service.mjs", bytes: 18000 }],
  });
  let offset = 0,
    combined = "";
  do {
    const result = readBuilderWorkspace(source, {
      kind: "workspace_read",
      revision: 1,
      path: "src/service.mjs",
      offset,
    });
    assert.ok(
      Buffer.byteLength(result.content) <= BUILDER_TOOL_LIMITS.readBytes,
    );
    assert.ok(!result.content.includes("�"));
    combined += result.content;
    offset = result.nextOffset;
  } while (offset !== null);
  assert.equal(combined, content);
  for (const overrides of [
    { revision: 2 },
    { path: "src/missing.mjs" },
    { offset: 9999 },
  ])
    assert.throws(() =>
      readBuilderWorkspace(source, {
        kind: "workspace_read",
        revision: 1,
        path: "src/service.mjs",
        offset: 0,
        ...overrides,
      }),
    );
  assert.deepEqual(readBuilderWorkspace(null, { kind: "workspace_list" }), {
    revision: 0,
    digest: null,
    files: [],
  });
});

test("the model only sees tools backed by supplied adapters and schemas cannot be mutated across calls", async () => {
  const missing = createWorkspaceTools({});
  assert.deepEqual(missing.definitions, []);
  await assert.rejects(
    missing.execute({ kind: "workspace_list" }, "one"),
    /unavailable/,
  );
  const read = createWorkspaceTools({
    read: async (_id, tool) => readBuilderWorkspace(null, tool),
  });
  assert.deepEqual(
    read.definitions.map((value) => value.kind),
    ["workspace_list", "workspace_read"],
  );
  assert.deepEqual(await read.execute({ kind: "workspace_list" }, "one"), {
    revision: 0,
    digest: null,
    files: [],
  });
  const full = builderToolDefinitions(BUILDER_TOOL_KINDS);
  assert.equal(full.length, 7);
  full.find(
    (value) => value.kind === "workspace_start",
  ).schema.properties.revision.maximum = 9999;
  assert.equal(
    builderToolDefinitions(["workspace_start"])[0].schema.properties.revision
      .maximum,
    Number.MAX_SAFE_INTEGER,
  );
});

test(
  "bounded model tools use real private workspace RPC receipts and cannot declare a generated service ready",
  { timeout: 15000 },
  async () => {
    const fixture = await workspaceFixture();
    const owned = await identity();
    const call = async (kind, input) => {
      const result = await fixture.call(kind, owned, input, {
        viaProvider: true,
      });
      assert.equal(result.status, 200, JSON.stringify(result));
      return result.result;
    };
    const tools = createWorkspaceTools({
      read: async (_id, tool) =>
        readBuilderWorkspace((await call("lookup")).source, tool),
      write: (input) => call("save", input),
      start: (input) => call("start", input),
      command: (input) => call("execute", input),
      receipt: (_id, target) => call("receipt", target),
    });
    try {
      const saved = await tools.execute(
        { kind: "workspace_write", expectedRevision: 0, files: files() },
        "write-1",
      );
      const reference = saved.result;
      assert.equal(saved.id, "write-1");
      const listing = await tools.execute({ kind: "workspace_list" }, "read-1");
      assert.equal(listing.revision, 1);
      assert.equal(listing.files.length, 2);
      assert.deepEqual(Object.keys(listing).sort(), [
        "digest",
        "files",
        "revision",
      ]);
      const start = await tools.execute(
        { kind: "workspace_start", ...reference },
        "start-1",
      );
      assert.equal(start.status, "completed");
      const result = await tools.execute(
        {
          kind: "workspace_test",
          ...reference,
          paths: ["tests/service.test.mjs"],
        },
        "test-1",
      );
      assert.equal(result.result.exitCode, 0);
      assert.equal(Object.hasOwn(result, "ready"), false);
      assert.deepEqual(
        await tools.execute(
          { kind: "workspace_result", operationId: "test-1" },
          "read-2",
        ),
        result,
      );
      assert.deepEqual(
        await tools.execute(
          { kind: "workspace_result", operationId: "missing" },
          "read-3",
        ),
        { operationId: "missing", status: "unknown", result: null },
      );
      const replay = await tools.execute(
        {
          kind: "workspace_test",
          ...reference,
          paths: ["tests/service.test.mjs"],
        },
        "test-1",
      );
      assert.deepEqual(replay, result);
      assert.equal(
        (await fixture.call("inspect", owned)).result.vm.executions,
        1,
      );
    } finally {
      await fixture.close();
    }
  },
);

test("provider success claims with wrong IDs, extra fields or excessive output are rejected", async () => {
  const valid = {
    id: "one",
    kind: "command",
    digest,
    status: "completed",
    result: { stdout: "ok", stderr: "", exitCode: 0 },
  };
  for (const receipt of [
    { ...valid, id: "foreign" },
    { ...valid, passed: true },
    { ...valid, result: { ...valid.result, stdout: "x".repeat(16385) } },
  ])
    await assert.rejects(
      createWorkspaceTools({ command: async () => receipt }).execute(
        {
          kind: "workspace_check",
          revision: 1,
          digest,
          path: "src/service.mjs",
        },
        "one",
      ),
    );
});

test("read adapters cannot return private metadata or an unbounded/mismatched source result", async () => {
  for (const value of [
    { revision: 0, digest: null, files: [], ownerId: "private" },
    { revision: 1, digest, files: [{ path: "../private.mjs", bytes: 2 }] },
  ])
    await assert.rejects(
      createWorkspaceTools({ read: async () => value }).execute(
        { kind: "workspace_list" },
        "list",
      ),
    );
  for (const value of [
    {
      revision: 2,
      digest,
      path: "src/a.mjs",
      offset: 0,
      content: "ok",
      nextOffset: null,
    },
    {
      revision: 1,
      digest,
      path: "src/a.mjs",
      offset: 0,
      content: "x".repeat(4097),
      nextOffset: null,
    },
  ])
    await assert.rejects(
      createWorkspaceTools({ read: async () => value }).execute(
        { kind: "workspace_read", revision: 1, path: "src/a.mjs", offset: 0 },
        "read",
      ),
    );
});
