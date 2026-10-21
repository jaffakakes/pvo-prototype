import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, request as httpRequest } from "node:http";
import test from "node:test";
import { createLocalAssistantApi } from "../scripts/dev/assistant.mjs";

async function beta(t, fetcher, options = {}) {
  let api;
  const server = createServer(
    (request, response) => void api.handle(request, response),
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  api = createLocalAssistantApi({ origin, fetcher, ...options });
  t.after(async () => {
    const closed = once(server, "close");
    server.close();
    server.closeAllConnections();
    await closed;
  });
  return {
    api,
    origin,
    send: (path, options = {}) =>
      fetch(`${origin}${path}`, {
        ...options,
        headers: {
          ...(options.method === "POST"
            ? { Origin: origin, "Content-Type": "application/json" }
            : {}),
          ...options.headers,
        },
      }),
  };
}

test("local assistant forwards status and tools to the fixed backend without credentials", async (t) => {
  const calls = [];
  const app = await beta(t, async (url, options) => {
    calls.push({ url, options });
    return Response.json(
      { available: true, model: "kimi-k2.6" },
      { headers: { "Set-Cookie": "remote=private" } },
    );
  });
  const response = await app.send("/api/assistant/status", {
    headers: {
      Cookie: "local=private",
      Authorization: "Bearer private",
      "CF-Connecting-IP": "forged",
    },
  });
  assert.deepEqual(await response.json(), {
    available: true,
    model: "kimi-k2.6",
  });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(calls[0].url, "https://getrestyle.app/api/assistant/status");
  assert.equal(calls[0].options.redirect, "manual");
  assert.deepEqual(calls[0].options.headers, {
    Accept: "application/json",
    Origin: "https://getrestyle.app",
    "Sec-Fetch-Site": "same-origin",
  });
  await app.send("/api/web/search?q=rounded%20buttons");
  assert.equal(
    calls[1].url,
    "https://getrestyle.app/api/web/search?q=rounded%20buttons",
  );
  for (const path of [
    "/api/assistant/tasks",
    "/api/auth/session",
    "/api/assistant/turn/",
    "/api/web/proxy",
  ]) {
    assert.equal(app.api.handles(path), false);
    assert.equal((await app.send(path)).status, 404);
  }
  assert.equal(calls.length, 2);
});

test("local assistant preserves request data and hosted quota failures", async (t) => {
  const payload = JSON.stringify({
    prompt: "Read this",
    attachments: [{ kind: "text", name: "note.txt", text: "Hello" }],
  });
  const app = await beta(t, async (url, options) => {
    assert.equal(url, "https://getrestyle.app/api/assistant/turn");
    assert.equal(options.body.toString(), payload);
    assert.equal(options.headers["x-assistant-animation"], "1");
    assert.equal(options.headers["x-assistant-saved-tasks"], undefined);
    return Response.json({ error: "Usage limit reached." }, { status: 429 });
  });
  const response = await app.send("/api/assistant/turn", {
    method: "POST",
    body: payload,
    headers: { "X-Assistant-Animation": "1", "X-Assistant-Saved-Tasks": "1" },
  });
  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), { error: "Usage limit reached." });
});

test("local assistant rejects cross-site requests, forged hosts and invalid methods before forwarding", async (t) => {
  let calls = 0;
  const app = await beta(t, async () => {
    calls++;
    return Response.json({});
  });
  for (const headers of [
    { Origin: "https://elsewhere.example" },
    { Origin: "" },
    { "Sec-Fetch-Site": "cross-site" },
  ]) {
    assert.equal(
      (
        await app.send("/api/assistant/turn", {
          method: "POST",
          body: "{}",
          headers,
        })
      ).status,
      403,
      JSON.stringify(headers),
    );
  }
  assert.equal(
    (
      await app.send("/api/assistant/status", {
        headers: { "Sec-Fetch-Site": "cross-site" },
      })
    ).status,
    403,
  );
  assert.equal((await app.send("/api/assistant/turn")).status, 405);
  assert.equal(
    (
      await app.send("/api/assistant/turn", {
        method: "POST",
        body: "{}",
        headers: { "Content-Type": "text/plain" },
      })
    ).status,
    415,
  );
  const forgedHost = await new Promise((resolve, reject) => {
    const request = httpRequest(
      `${app.origin}/api/assistant/status`,
      { headers: { Host: "elsewhere.example" } },
      (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode));
      },
    );
    request.on("error", reject);
    request.end();
  });
  assert.equal(forgedHost, 403);
  assert.equal(calls, 0);
});

test("local assistant bounds declared and streamed bodies before contacting the provider", async (t) => {
  let calls = 0;
  const app = await beta(t, async () => {
    calls++;
    return Response.json({});
  });
  assert.equal(
    (
      await app.send("/api/fonts/import", {
        method: "POST",
        body: "x".repeat(8193),
      })
    ).status,
    413,
  );
  const streamed = await new Promise((resolve, reject) => {
    const request = httpRequest(
      `${app.origin}/api/fonts/import`,
      {
        method: "POST",
        headers: {
          Origin: app.origin,
          "Content-Type": "application/json",
          "Transfer-Encoding": "chunked",
        },
      },
      (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode));
      },
    );
    request.on("error", reject);
    request.write("x".repeat(8192));
    request.end("x");
  });
  assert.equal(streamed, 413);
  assert.equal(calls, 0);
});

test("local voice preserves binary audio and its duration", async (t) => {
  const audio = Buffer.from([82, 73, 70, 70, 0, 255]);
  const app = await beta(t, async (_url, options) => {
    assert.deepEqual(options.body, audio);
    assert.equal(options.headers["Content-Type"], "audio/wav");
    assert.equal(options.headers["x-audio-duration"], "1.5");
    return Response.json({ text: "Hello", segments: [] });
  });
  const response = await app.send("/api/assistant/transcribe", {
    method: "POST",
    body: audio,
    headers: { "Content-Type": "audio/wav", "X-Audio-Duration": "1.5" },
  });
  assert.equal((await response.json()).text, "Hello");
});

test("redirects, malformed responses and upstream failures remain uncached connection failures", async (t) => {
  for (const reply of [
    () => Response.redirect("https://elsewhere.example"),
    () => new Response("private upstream diagnostic", { status: 502 }),
    () =>
      new Response("invalid", {
        headers: { "Content-Type": "application/json" },
      }),
    () => Response.json({ text: "x".repeat(2 * 1024 * 1024) }),
    () => {
      throw new Error("private token");
    },
  ]) {
    const app = await beta(t, async () => reply());
    const response = await app.send("/api/assistant/status");
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("location"), null);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), {
      error: "The assistant could not connect. Please try again.",
    });
  }
});

test("Stop cancels the upstream request when the browser disconnects", async (t) => {
  let started;
  let canceled;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const stopped = new Promise((resolve) => {
    canceled = resolve;
  });
  const app = await beta(
    t,
    (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            canceled();
            reject(signal.reason);
          },
          { once: true },
        );
        started();
      }),
  );
  const controller = new AbortController();
  const result = app.send("/api/assistant/turn", {
    method: "POST",
    body: "{}",
    signal: controller.signal,
  });
  await ready;
  controller.abort();
  await assert.rejects(result, { name: "AbortError" });
  await stopped;
});

test("a stalled upstream body is canceled at the deadline", async (t) => {
  let canceled = false;
  const app = await beta(
    t,
    async () =>
      new Response(
        new ReadableStream({
          cancel() {
            canceled = true;
          },
        }),
        {
          headers: { "Content-Type": "application/json" },
        },
      ),
    { timeoutMs: 50 },
  );
  assert.equal((await app.send("/api/assistant/status")).status, 503);
  assert.equal(canceled, true);
});

test("disconnecting during upload cancels the reader without starting inference", async (t) => {
  let calls = 0;
  const app = await beta(t, async () => {
    calls++;
    return Response.json({});
  });
  const request = httpRequest(`${app.origin}/api/assistant/turn`, {
    method: "POST",
    headers: {
      Origin: app.origin,
      "Content-Type": "application/json",
      "Transfer-Encoding": "chunked",
    },
  });
  request.on("error", () => {});
  request.write('{"prompt":"');
  await new Promise((resolve) => setTimeout(resolve, 20));
  request.destroy();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(calls, 0);
});
