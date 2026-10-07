import test from "node:test";
import assert from "node:assert/strict";
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
  const bootstrap = `import http from 'node:http';import {syncBuiltinESMExports} from 'node:module';const original=http.request;http.request=(options,callback)=>original({...options,port:${server.address().port}},callback);syncBuiltinESMExports();`;
  return async (body) => {
    const encoded = Buffer.from(
      JSON.stringify({ path: "/execute", body }),
    ).toString("base64");
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [
        "--import",
        "data:text/javascript," + encodeURIComponent(bootstrap),
        new URL(
          "../../server/cloud-services/node/guest/bridge.mjs",
          import.meta.url,
        ).pathname,
        ...encoded.match(/.{1,65536}/g),
      ],
      { timeout: 4000, maxBuffer: 128 * 1024 },
    );
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
