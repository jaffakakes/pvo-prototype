import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { HttpError } from "../server/http.js";
import { testConsent, testRecipient } from "../server/imessage/phone.js";
import { imessageRoute } from "../server/imessage/routes.js";

const origin = "https://restyle.example";
const token = "test-secret-with-at-least-thirty-two-characters";

function request(path, body, headers = {}) {
  return new Request(`${origin}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Origin: origin, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function environment(sender) {
  return { IMESSAGE_BRIDGE_TOKEN: token, IMESSAGE_TEST_QUEUE: { getByName: () => sender } };
}

test("test recipient requires a bounded international phone number and explicit opt-in", () => {
  assert.equal(testRecipient("+44 (7700) 900-123"), "+447700900123");
  for (const invalid of ["07700900123", "44123456789", "+00000000", "+123", "a".repeat(41), {}, null])
    assert.throws(() => testRecipient(invalid), HttpError);
  assert.throws(() => testConsent(false), /Confirm that you want/);
  assert.doesNotThrow(() => testConsent(true));
});

test("a consented form waits until the Mac reports the test message accepted", async () => {
  const calls = [];
  const sender = {
    async enqueue(phone, key) { calls.push({ phone, key }); return { status: "queued", id: "job-1" }; },
    async result(id) { assert.equal(id, "job-1"); return "sent"; },
  };
  const response = await imessageRoute(request("/api/imessage/test", { phone: "+44 7700 900123", consent: true }), environment(sender));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { sent: true });
  assert.equal(calls[0].phone, "+447700900123");
  assert.match(calls[0].key, /^[a-f0-9]{64}$/);
  assert.ok(!calls[0].key.includes("7700"));
});

test("a form without consent, a country code or a matching origin never queues a message", async () => {
  let queued = 0;
  const sender = { async enqueue() { queued++; } };
  for (const input of [{ phone: "+447700900123" }, { phone: "07700900123", consent: true }])
    await assert.rejects(imessageRoute(request("/api/imessage/test", input), environment(sender)), HttpError);
  await assert.rejects(imessageRoute(request("/api/imessage/test", { phone: "+447700900123", consent: true },
    { Origin: "https://another.example" }), environment(sender)), /start from the editor/);
  assert.equal(queued, 0);
});

test("the Mac sender needs its secret, while an offline Mac fails before accepting a form", async () => {
  let claimed = 0;
  const sender = {
    async claim() { claimed++; return null; },
    async enqueue() { return { status: "offline" }; },
  };
  await assert.rejects(imessageRoute(request("/api/imessage/next"), environment(sender)), /authorization required/);
  assert.equal(claimed, 0);
  await assert.rejects(imessageRoute(request("/api/imessage/test", { phone: "+447700900123", consent: true }), environment(sender)),
    /offline/);
  const response = await imessageRoute(request("/api/imessage/next", undefined, { Authorization: `Bearer ${token}` }), environment(sender));
  assert.equal(response.status, 204);
  assert.equal(claimed, 1);
});

test("the standalone page can read sender availability without an Origin header", async () => {
  const sender = { async status() { return { online: false }; } };
  const response = await imessageRoute(new Request(`${origin}/api/imessage/status`), environment(sender));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { online: false });
});

test("the queue permits repeated requests to one number until the daily cap", async () => {
  const bundle = await build({ stdin: {
    contents: `import { IMessageTestQueue } from "./server/imessage/queue.js";
      export { IMessageTestQueue };
      export default { async fetch(request, env) {
        const queue = env.QUEUE.getByName("beta");
        if (new URL(request.url).pathname === "/heartbeat") return Response.json(await queue.claim());
        return Response.json(await queue.enqueue("+447700900123", "same-recipient"));
      } };`,
    resolveDir: process.cwd(),
  }, bundle: true, write: false, format: "esm", platform: "browser", external: ["cloudflare:workers"] });
  const mf = new Miniflare(convertV4MiniflareOptions({ name: "imessage-repeat-test", modules: true,
    script: bundle.outputFiles[0].text, compatibilityDate: "2026-09-27",
    durableObjects: { QUEUE: { className: "IMessageTestQueue", useSQLite: true } },
  }));
  try {
    await mf.dispatchFetch(`${origin}/heartbeat`);
    const enqueue = async () => (await mf.dispatchFetch(`${origin}/enqueue`)).json();
    const first = await enqueue();
    const second = await enqueue();
    assert.equal(first.status, "queued");
    assert.equal(second.status, "queued", "a second request to the same number is allowed");
    assert.notEqual(first.id, second.id);
    for (let count = 2; count < 10; count++) assert.equal((await enqueue()).status, "queued");
    assert.equal((await enqueue()).status, "limit", "the total daily cap remains active");
  } finally {
    await mf.dispose();
  }
});
