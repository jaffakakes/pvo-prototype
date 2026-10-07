import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

async function fixture(t, respond) {
  const server = createServer(async (request, response) => {
    const parts = [];
    for await (const part of request) parts.push(part);
    respond(request, response, Buffer.concat(parts).toString("utf8"));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  // Keep the production target fixed. The isolated test process redirects only its HTTP port.
  const bootstrap = `import {readFileSync} from 'node:fs';process.argv.push(...readFileSync(0,'utf8').match(/.{1,65536}/g));import http from 'node:http';import {syncBuiltinESMExports} from 'node:module';const original=http.request;http.request=(options,callback)=>original({...options,port:${server.address().port}},callback);syncBuiltinESMExports();`;
  return async (body) => {
    const encoded = Buffer.from(body).toString("base64");
    // macOS has a smaller argv ceiling; populate the same guest arguments inside this HTTP test process.
    // The Fly proof separately exercises Linux exec with the complete argument vector.
    const running = promisify(execFile)(
      process.execPath,
      [
        "--import",
        "data:text/javascript," + encodeURIComponent(bootstrap),
        new URL(
          "../../server/cloud-services/node/guest/bridge.mjs",
          import.meta.url,
        ).pathname,
        "--execute",
      ],
      { timeout: 4000, maxBuffer: 128 * 1024 },
    );
    running.child.stdin.end(encoded);
    const { stdout } = await running;
    return JSON.parse(stdout);
  };
}

test("guest bridge transports literal UTF-8 arguments and bounds actual HTTP response bytes", async (t) => {
  const invoke = await fixture(t, (request, response, body) => {
    response.setHeader("Connection", "close");
    response.end(JSON.stringify({ path: request.url, body }));
  });
  const body = "日本語 '';$(not-a-command)";
  const echoed = await invoke(body);
  assert.equal(echoed.status, 200);
  assert.deepEqual(JSON.parse(echoed.body), { path: "/execute", body });
  assert.deepEqual(await invoke(body.repeat(3000)), { status: 413, body: "" });
});

test("guest HTTP bridge times out even when the listener leaves the connection open", async (t) => {
  const invoke = await fixture(t, () => {});
  assert.deepEqual(await invoke("never-reply"), { status: 504, body: "" });
});

test("maximum admitted escaped bytes reach actual HTTP unchanged without a second JSON expansion", async (t) => {
  const digest = (value) => createHash("sha256").update(value).digest("hex");
  const invoke = await fixture(t, (_request, response, body) => {
    response.end(digest(body));
  });
  const body = JSON.stringify({ source: "\\".repeat(500000) });
  const reply = await invoke(body);
  assert.equal(reply.status, 200);
  assert.equal(reply.body, digest(body));
});
