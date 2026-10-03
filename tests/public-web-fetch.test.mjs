import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { publicHttpsUrl, isPublicAddress } from "../server/web/publicAddress.js";
import { readPublicResource } from "../server/web/publicFetch.js";

const publicHost = async () => ["93.184.216.34", "2606:4700:4700::1111"];

test("public URLs reject local, literal-IP, credential and non-HTTPS destinations", () => {
  for (const url of ["http://example.com", "https://localhost", "https://app.internal", "https://printer.local",
    "https://127.0.0.1", "https://127.1", "https://2130706433", "https://0x7f000001", "https://[::1]",
    "https://example.com:8080", "https://user:secret@example.com", "https://example.com.", "file:///etc/passwd"])
    assert.throws(() => publicHttpsUrl(url), error => error.status === 400, url);
  assert.equal(publicHttpsUrl("https://example.com:443/font.woff2#sample").href, "https://example.com/font.woff2");
});

test("DNS validation rejects private, reserved, mapped and non-global IPv6 addresses", () => {
  for (const address of ["10.0.0.1", "127.0.0.1", "100.64.0.1", "169.254.169.254", "172.16.0.1",
    "192.168.1.1", "192.0.2.1", "198.18.0.1", "203.0.113.1", "224.0.0.1", "0.0.0.0",
    "::", "::1", "::ffff:127.0.0.1", "fc00::1", "fe80::1", "2001:db8::1", "2001::1", "3fff::1", "not-an-ip"])
    assert.equal(isPublicAddress(address), false, address);
  for (const address of ["93.184.216.34", "1.1.1.1", "2606:4700:4700::1111", "2001:4860:4860::8888"])
    assert.equal(isPublicAddress(address), true, address);
});

test("every redirect is verified before fetch and no credentials or caller headers are forwarded", async () => {
  const calls = [];
  const resolved = [];
  const result = await readPublicResource("https://example.com/font", {
    resolveHost: async host => { resolved.push(host); return publicHost(); },
    fetch: async (url, options) => {
      calls.push([url, options]);
      return calls.length === 1 ? new Response(null, { status: 302, headers: { Location: "https://cdn.example.com/font.woff2" } })
        : new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "font/woff2" } });
    },
  });
  assert.deepEqual(resolved, ["example.com", "cdn.example.com"]);
  assert.equal(result.url, "https://cdn.example.com/font.woff2");
  assert.deepEqual([...result.bytes], [1, 2, 3]);
  for (const [, options] of calls) {
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "manual");
    assert.equal(options.credentials, "omit");
    assert.deepEqual(options.headers, { Accept: "*/*" });
  }
});

test("mixed DNS records, private redirect targets and provider host changes fail before destination fetch", async () => {
  let calls = 0;
  await assert.rejects(readPublicResource("https://example.com", {
    resolveHost: async () => ["93.184.216.34", "127.0.0.1"], fetch: async () => { calls++; },
  }), error => error.status === 400);
  assert.equal(calls, 0);
  for (const location of ["https://127.0.0.1/", "http://example.com", "https://other.example.com"]) {
    calls = 0;
    await assert.rejects(readPublicResource("https://example.com", { allowedHosts: ["example.com"], resolveHost: publicHost,
      fetch: async () => { calls++; return new Response(null, { status: 302, headers: { Location: location } }); },
    }), error => [400, 502].includes(error.status));
    assert.equal(calls, 1);
  }
});

test("fixed DNS queries verify A and AAAA and never forward to a failed or private resolution", async () => {
  const queried = [];
  await assert.rejects(readPublicResource("https://example.com", { fetch: async (value, options) => {
    const url = new URL(value);
    assert.equal(url.origin, "https://dns.google");
    assert.equal(options.redirect, "manual");
    queried.push(url.searchParams.get("type"));
    return Response.json({ Status: 0, Answer: [{ type: url.searchParams.get("type") === "A" ? 1 : 28,
      data: url.searchParams.get("type") === "A" ? "93.184.216.34" : "::1" }] });
  } }), error => error.status === 400);
  assert.deepEqual(queried.sort(), ["A", "AAAA"]);
});

test("resource size limits cancel owned streams and cancellation cannot return partial data", async () => {
  let cancelled = false;
  await assert.rejects(readPublicResource("https://example.com", { maxBytes: 2, resolveHost: publicHost,
    fetch: async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(3)); },
      cancel() { cancelled = true; } })),
  }), error => error.status === 413);
  assert.equal(cancelled, true);
  const controller = new AbortController();
  let reading;
  const started = new Promise(resolve => { reading = resolve; });
  const pending = readPublicResource("https://example.com", { signal: controller.signal, resolveHost: publicHost,
    fetch: async () => new Response(new ReadableStream({ pull() { reading(); }, cancel() { cancelled = true; } })),
  });
  await started;
  cancelled = false;
  controller.abort();
  await assert.rejects(pending, error => error.name === "AbortError");
  assert.equal(cancelled, true);
});

test("deadline and upstream failures use safe errors without private network diagnostics", async () => {
  await assert.rejects(readPublicResource("https://example.com", { timeoutMs: 10, resolveHost: publicHost,
    fetch: async (_url, { signal }) => {
      // Native timeout signals do not keep Node alive; model an owned request
      // handle that stays pending until the deadline aborts and releases it.
      await delay(1000, undefined, { signal });
      throw new Error("The stalled test request was not aborted.");
    },
  }), error => error.status === 504);
  await assert.rejects(readPublicResource("https://example.com", { resolveHost: publicHost,
    fetch: async () => { throw new Error("private network detail"); },
  }), error => error.status === 502 && !error.message.includes("private"));
});
