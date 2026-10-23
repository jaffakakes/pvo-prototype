import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { FlyNodeContainer } from "../../server/cloud-services/node/fly/container.js";
import { NODE_RUNTIME } from "../../server/cloud-services/node/runtime.js";
import { nodeExecutionBody } from "../../server/cloud-services/node/protocol.js";

const execution = "00000000-0000-4000-8000-000000000001";
const app = "restyle-owned";
const image = `registry.fly.io/${app}@${NODE_RUNTIME.imageDigest}`;
const bundle = {
  entrypoint: "src/main.mjs",
  files: [
    { path: "src/main.mjs", content: "export function execute(){return null}" },
  ],
  dependencies: [],
};
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

function provider(overrides = {}) {
  let record = null,
    machine = null,
    now = 0,
    readyCalls = 0;
  const calls = [],
    pieces = new Map();
  const controller = new AbortController();
  let expectedBody;
  const options = {
    app,
    image,
    token: "test-private-token",
    read: () => structuredClone(record),
    write: (value) => {
      record = structuredClone(value);
    },
    clock: {
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    },
    fetchImpl: async (url, init) => {
      const path = new URL(url).pathname;
      const body = init.body && JSON.parse(init.body);
      calls.push({ method: init.method, path, body, at: now });
      if (init.method === "POST" && path.endsWith("/machines")) {
        assert.equal(record.phase, "dispatching");
        assert.equal(body.config.image, image);
        assert.deepEqual(body.config.services, []);
        assert.deepEqual(body.config.mounts, []);
        assert.deepEqual(body.config.env, {});
        assert.equal(body.skip_secrets, true);
        assert.equal(body.skip_launch, true);
        assert.equal(body.config.restart.policy, "no");
        assert.equal(body.config.guest.memory_mb, 1024);
        for (const file of body.config.files) {
          assert.equal(file.mode, 0o600);
          pieces.set(file.guest_path, Buffer.from(file.raw_value, "base64"));
        }
        machine = {
          id: "1234567890abcd",
          name: body.name,
          config: body.config,
          image_ref: { digest: NODE_RUNTIME.imageDigest },
          state: "stopped",
        };
        return Response.json(machine);
      }
      if (init.method === "GET") {
        overrides.inspect?.({ calls, controller });
        return machine
          ? Response.json(machine)
          : new Response(null, { status: 404 });
      }
      if (path.endsWith("/start")) {
        assert.equal(record.startRequested, true);
        machine.state = "started";
        if (overrides.lostStart) throw new TypeError("Lost start reply");
        return Response.json({});
      }
      if (init.method === "DELETE") {
        machine = null;
        return Response.json({});
      }
      assert.ok(path.endsWith("/exec"));
      if (body.cmd.endsWith("'--ready'")) {
        readyCalls++;
        return Response.json({
          stdout: JSON.stringify({
            status: overrides.pending && readyCalls === 1 ? 503 : 200,
            body: JSON.stringify({
              nodeVersion: overrides.wrongVersion
                ? "0.0.0"
                : NODE_RUNTIME.nodeVersion,
              runnerDigest: NODE_RUNTIME.runnerDigest,
            }),
          }),
        });
      }
      if (body.cmd.endsWith("'--execute'")) {
        const manifest = JSON.parse(pieces.get("/control/invocation.json"));
        const input = Buffer.concat(
          Array.from({ length: manifest.parts }, (_, index) =>
            pieces.get(`/control/invocation/${String(index).padStart(3, "0")}`),
          ),
        );
        assert.equal(input.length, manifest.bytes);
        assert.equal(hash(input), manifest.sha256);
        assert.equal(input.toString(), expectedBody);
        return Response.json({
          stdout: JSON.stringify({ status: 200, body: '{"accepted":true}' }),
        });
      }
      const match = body.cmd.match(
        /'restyle-input' '(\d{3})' '([A-Za-z0-9+/]+=*)'$/,
      );
      assert.ok(match);
      const bytes = Buffer.from(match[2], "base64"),
        target = `/control/invocation/${match[1]}`;
      pieces.set(target, bytes);
      return Response.json({ stdout: `${hash(bytes)}  ${target}\n` });
    },
  };
  return {
    open: () => new FlyNodeContainer(options),
    read: options.read,
    calls,
    controller,
    expect: (body) => {
      expectedBody = body;
    },
  };
}

test("the product adapter delivers exact large bytes, observes a lost start and destroys the whole Machine", async () => {
  const f = provider({ lostStart: true, pending: true });
  const value = {
    ...bundle,
    files: [
      ...bundle.files,
      ...Array.from({ length: 8 }, (_, i) => ({
        path: `src/data-${i}.mjs`,
        content: '漢"\\'.repeat(16000),
      })),
      {
        path: "tests/private.mjs",
        content: "expected answers must stay outside",
      },
    ],
  };
  const invocation = { input: { name: 'quoted"data' } },
    body = nodeExecutionBody(value, invocation);
  assert.ok(Buffer.byteLength(body) > 700000);
  f.expect(body);
  const container = f.open(),
    signal = f.controller.signal;
  await container.start(execution, body, () => {}, signal);
  await container.ready(() => {}, signal);
  assert.deepEqual(
    await container.execute(value, invocation, () => {}, signal),
    { accepted: true },
  );
  const commands = f.calls.filter((call) => call.path.endsWith("/exec"));
  for (let i = 1; i < commands.length; i++)
    assert.ok(commands[i].at - commands[i - 1].at >= 1100);
  assert.equal(
    f.calls.filter((call) => call.path.endsWith("/start")).length,
    1,
  );
  await f.open().destroy(execution);
  assert.equal(f.read(), null);
  assert.equal(f.calls.filter((call) => call.method === "DELETE").length, 1);
});

test("cancellation or a stale lease during inspection cannot start the stopped Machine", async () => {
  for (const abort of [true, false]) {
    let current = true,
      inspections = 0;
    const f = provider({
      inspect: ({ controller }) => {
        if (++inspections === 2) {
          current = false;
          if (abort) controller.abort();
        }
      },
    });
    const check = () => {
      if (!current) throw new Error("stale lease");
    };
    const container = f.open(),
      signal = f.controller.signal;
    await container.start(
      execution,
      nodeExecutionBody(bundle, {}),
      check,
      signal,
    );
    await assert.rejects(container.ready(check, signal));
    assert.equal(
      f.calls.filter(
        (call) => call.path.endsWith("/start") || call.path.endsWith("/exec"),
      ).length,
      0,
    );
    await f.open().destroy(execution);
    assert.equal(f.read(), null);
  }
});

test("runtime mismatch and changed input cannot dispatch generated execution", async () => {
  const f = provider({ wrongVersion: true }),
    container = f.open(),
    signal = f.controller.signal;
  await container.start(
    execution,
    nodeExecutionBody(bundle, {}),
    () => {},
    signal,
  );
  await assert.rejects(
    container.ready(() => {}, signal),
    { code: "runtime_mismatch" },
  );
  await assert.rejects(
    container.execute(bundle, { changed: true }, () => {}, signal),
    { code: "invalid_input" },
  );
  assert.equal(
    f.calls.filter((call) => call.body?.cmd?.endsWith("'--execute'")).length,
    0,
  );
  await f.open().destroy(execution);
  assert.equal(f.read(), null);
});
