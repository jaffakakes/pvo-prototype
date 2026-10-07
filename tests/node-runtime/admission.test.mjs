import test from "node:test";
import assert from "node:assert/strict";
import {
  parseNodeBundle,
  supportedNodeLibraries,
} from "../../packages/pvo-assistant/services/index.js";
import { NodeContainer } from "../../server/cloud-services/node/container.js";
import { readNodeReply } from "../../server/cloud-services/node/protocol.js";
import { NODE_RUNTIME } from "../../server/cloud-services/node/runtime.js";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

test("Node admission rejects altered libraries and traversal while retaining exact supported bytes", () => {
  const bundle = {
    entrypoint: "src/main.mjs",
    files: [
      {
        path: "src/main.mjs",
        content: "export function execute(){return null}",
      },
    ],
    dependencies: supportedNodeLibraries(),
  };
  assert.deepEqual(parseNodeBundle(bundle), bundle);
  for (const edit of [
    (b) => (b.dependencies[0].files[0].content += "modified"),
    (b) => (b.dependencies[0].version = "latest"),
    (b) => (b.files[0].path = "src/../escape.mjs"),
    (b) => (b.entrypoint = "tests/main.test.mjs"),
    (b) => (b.secrets = { key: "not allowed" }),
  ]) {
    const changed = structuredClone(bundle);
    edit(changed);
    assert.throws(() => parseNodeBundle(changed));
  }
  const changed = supportedNodeLibraries();
  changed[0].files[0].content = "mutated returned value";
  assert.deepEqual(
    parseNodeBundle(bundle),
    bundle,
    "Callers cannot mutate retained lock authority",
  );
});

test("outside-guest reader rejects excess, malformed UTF-8 and lying lengths", async () => {
  const signal = new AbortController().signal;
  await assert.rejects(
    readNodeReply(
      new Response('"' + "a".repeat(100) + '"', {
        headers: { "Content-Length": "2" },
      }),
      32,
      signal,
    ),
    { code: "output_limit" },
  );
  await assert.rejects(
    readNodeReply(new Response(new Uint8Array([0xff])), 32, signal),
    { code: "invalid_reply" },
  );
  await assert.rejects(readNodeReply(new Response("not JSON"), 32, signal), {
    code: "invalid_reply",
  });
  assert.deepEqual(
    await readNodeReply(Response.json({ ok: true }), 32, signal),
    { ok: true },
  );
});

test("pinned runtime identity is checked before generated execution", async () => {
  const image = "registry.test/image@sha256:" + "a".repeat(64),
    signal = new AbortController().signal;
  let fetches = 0;
  const native = {
    images: { runtime: image },
    setInactivityTimeout: async () => {},
    inspect: async () => ({ image }),
    getTcpPort: () => ({
      fetch: async () => {
        fetches++;
        return Response.json({ ...NODE_RUNTIME, runnerDigest: "wrong" });
      },
    }),
  };
  await assert.rejects(
    new NodeContainer(native).ready(() => {}, signal),
    { code: "runtime_mismatch" },
  );
  assert.equal(fetches, 1);
  native.inspect = async () => ({ image: image.replace(/a$/, "b") });
  await assert.rejects(
    new NodeContainer(native).ready(() => {}, signal),
    { code: "runtime_mismatch" },
  );
  assert.equal(
    fetches,
    1,
    "A changed provider image is rejected before HTTP readiness",
  );
  const sources = await Promise.all(
    ["files.mjs", "server.mjs"].map(async (path) => ({
      path,
      content: await readFile(
        new URL(
          `../../server/cloud-services/node/guest/${path}`,
          import.meta.url,
        ),
        "utf8",
      ),
    })),
  );
  assert.equal(
    createHash("sha256").update(JSON.stringify(sources)).digest("hex"),
    NODE_RUNTIME.runnerDigest,
    "Runner edits must change the checked runtime identity",
  );
});

test("only source modules and invocation enter the guest, never generated tests", async () => {
  let body;
  const native = {
    getTcpPort: () => ({
      fetch: async (_, options) => {
        body = JSON.parse(options.body);
        return Response.json({ result: "ok", state: {} });
      },
    }),
  };
  await new NodeContainer(native).execute(
    {
      entrypoint: "src/main.mjs",
      files: [
        { path: "src/main.mjs", content: "source" },
        { path: "tests/main.test.mjs", content: "private expected answer" },
      ],
      dependencies: [],
    },
    { operation: "test", input: {}, state: {}, now: 0 },
    () => {},
    new AbortController().signal,
  );
  assert.deepEqual(body.bundle.files, [
    { path: "src/main.mjs", content: "source" },
  ]);
  assert.equal(JSON.stringify(body).includes("private expected answer"), false);
});

test("startup and transport failures remain infrastructure failures rather than false source-test failures", async () => {
  const signal = new AbortController().signal;
  const slow = new NodeContainer({
    setInactivityTimeout: async () => {
      throw Object.assign(new Error("deadline"), { status: 504 });
    },
  });
  await assert.rejects(
    slow.ready(() => {}, signal),
    { code: "startup_timeout" },
  );
  const broken = new NodeContainer({
    getTcpPort: () => ({
      fetch: async () => {
        throw new Error("connection lost");
      },
    }),
  });
  await assert.rejects(
    broken.execute({ files: [] }, {}, () => {}, signal),
    { code: "runtime_unavailable" },
  );
});
