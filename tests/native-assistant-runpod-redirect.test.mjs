import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { bundleWorkerModules } from "./worker-bundle.helpers.mjs";

test("the real Worker fetch accepts the Runpod redirect mode and never forwards authorization after a redirect", async t => {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({ path: request.url, authorization: request.headers.authorization });
    if (request.url === "/ok") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ready: true }));
      return;
    }
    if (request.url?.startsWith("/redirect/")) {
      response.writeHead(Number(request.url.split("/").at(-1)), { Location: "/credential-target" });
      response.end("A provider redirect must not be followed.");
      return;
    }
    response.writeHead(500);
    response.end("Unexpected credential forwarding target.");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address();
  const modules = await bundleWorkerModules({ stdin: { resolveDir: process.cwd(), contents: `
    import { requestRunpodJson } from "./server/assistant/native/runpodHttp.js";
    export default { async fetch(request, env) {
      try {
        const result = await requestRunpodJson("/v2/test-model/run", {}, env.RUNPOD_API_KEY, request.signal, {
          // Map only the destination for this test. Worker fetch receives the
          // adapter's actual method, headers, body, redirect mode and signal.
          fetch: (_url, options) => fetch(env.MODEL_ORIGIN + new URL(request.url).pathname, options),
        });
        return Response.json(result);
      } catch (error) {
        return Response.json({ error: error.message }, { status: error.status ?? 500 });
      }
    } };
  ` } });
  const worker = new Miniflare(convertV4MiniflareOptions({ name: "native-runpod-redirect-test", modules,
    compatibilityDate: "2026-09-27", bindings: {
      RUNPOD_API_KEY: "server-test-key", MODEL_ORIGIN: `http://127.0.0.1:${address.port}`,
    },
  }));
  t.after(() => worker.dispose());
  const success = await worker.dispatchFetch("https://native-assistant.example/ok");
  assert.equal(success.status, 200, "The selected redirect mode must be accepted by Worker fetch");
  assert.deepEqual(await success.json(), { ready: true });
  for (const status of [301, 302, 303, 307, 308]) {
    const response = await worker.dispatchFetch(`https://native-assistant.example/redirect/${status}`);
    assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /server-test-key|credential-target/);
  }
  assert.equal(requests.length, 6, "One provider request per call, with no redirect follow-ups");
  assert.ok(requests.every(request => request.authorization === "Bearer server-test-key"));
  assert.ok(requests.every(request => request.path !== "/credential-target"));
});
