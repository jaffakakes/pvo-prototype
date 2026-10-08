import test from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { createTask } from "../../packages/pvo-assistant/tasks/index.js";
import { input, ownerId, now, hash } from "../assistant-tasks/fixtures.mjs";
const bundle = buildSync({
  entryPoints: ["editor/src/infrastructure/connections/accountConnections.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
});
const transport = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

test("private transport binds the displayed owner and accepts a full sized saved task after setup", async (t) => {
  const request = input();
  request.context.components = Array.from({ length: 5 }, (_, index) => ({
    ...request.context.components[0],
    id: `component-${index}`,
    source: { structure: "x".repeat(15000), style: "", logic: "" },
  }));
  const task = createTask(request, {
    id: "large-task",
    ownerId,
    now,
    inputDigest: hash,
  });
  assert.ok(JSON.stringify(task).length > 65536);
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "/api/account-connections/attach");
    assert.equal(options.headers["X-Restyle-Owner"], ownerId);
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, undefined);
    return Response.json({ task });
  });
  const result = await transport.attachAccountConnection(
    ownerId,
    "connection-one",
    task,
    "question-one",
    "attach-one",
    new AbortController().signal,
  );
  assert.deepEqual(result, task);
});

test("connection errors discard private server bodies", async (t) => {
  const secret = "private-response-not-for-diagnostics";
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ error: secret }, { status: 403 }),
  );
  await assert.rejects(
    transport.listAccountConnections(
      ownerId,
      null,
      new AbortController().signal,
    ),
    (error) =>
      error.message.includes("account changed") &&
      !error.message.includes(secret),
  );
});
