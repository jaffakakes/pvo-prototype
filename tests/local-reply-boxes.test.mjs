import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createLocalSessions } from "../scripts/dev/local-sessions.mjs";
import { createLocalReplyBoxApi } from "../scripts/dev/reply-boxes/routes.mjs";

async function beta(directory) {
  const sessions = await createLocalSessions({ directory });
  const replies = await createLocalReplyBoxApi({ sessions, directory });
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host}`);
      if (url.pathname.startsWith("/api/reply-boxes"))
        await replies.handle(request, response, url.pathname, url.origin);
      else {
        response.writeHead(404).end();
      }
    } catch (error) {
      response.writeHead(500).end(String(error));
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    request(path, { cookie, method = "GET", body, headers = {} } = {}) {
      return fetch(`${origin}${path}`, {
        method,
        body: body === undefined ? undefined : JSON.stringify(body),
        headers: {
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(cookie ? { Cookie: cookie } : {}),
          ...(method === "GET" ? {} : { Origin: origin }),
          ...headers,
        },
      });
    },
    async close() {
      const closed = once(server, "close");
      server.close();
      server.closeAllConnections();
      await closed;
      await replies.close();
    },
  };
}

test("local reply boxes persist across beta restarts", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "pvo-local-replies-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let app = await beta(directory);
  t.after(async () => {
    await app?.close();
  });

  const created = await app.request("/api/reply-boxes", {
    method: "POST",
    body: { title: "  Contact me  " },
  });
  assert.equal(created.status, 201);
  const first = await created.json();
  assert.match(first.id, /^[A-Za-z0-9_-]{22}$/);
  assert.equal(first.title, "Contact me");
  assert.equal(first.url, `${app.origin}/api/reply-boxes/${first.id}/replies`);
  const cookie = created.headers.get("set-cookie").split(";", 1)[0];

  assert.equal(
    (await app.request("/api/publishing/session", { method: "POST", cookie }))
      .status,
    404,
  );
  const listed = (
    await (await app.request("/api/reply-boxes", { cookie })).json()
  ).boxes;
  assert.deepEqual(
    listed.map((box) => box.id),
    [first.id],
  );
  assert.equal(listed[0].count, 0);

  const preflight = await app.request(`/api/reply-boxes/${first.id}/replies`, {
    method: "OPTIONS",
    headers: {
      Origin: "https://another.example",
      "Access-Control-Request-Method": "POST",
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "*");

  const answers = [
    { name: "Your message", type: "text", value: "Hello from the video" },
  ];
  const sent = await app.request(`/api/reply-boxes/${first.id}/replies`, {
    method: "POST",
    body: { answers },
    headers: { Origin: "https://another.example" },
  });
  assert.equal(sent.status, 201);
  assert.deepEqual(await sent.json(), { accepted: true });
  assert.equal(sent.headers.get("access-control-allow-origin"), "*");
  assert.equal(
    (await app.request(`/api/reply-boxes/${first.id}/replies`)).status,
    401,
  );
  const read = await app.request(`/api/reply-boxes/${first.id}/replies`, {
    cookie,
  });
  assert.equal(read.status, 200);
  const received = (await read.json()).replies;
  assert.equal(received.length, 1);
  assert.deepEqual(received[0].answers, answers);

  const stored = await readFile(join(directory, "reply-boxes.json"), "utf8");
  assert(
    !stored.includes(cookie),
    "The bearer cookie must never be stored with replies.",
  );
  assert(
    !stored.includes(cookie.split("=", 2)[1].split(".", 1)[0]),
    "The raw session ID must not be stored.",
  );
  await app.close();
  app = null;
  app = await beta(directory);
  const restored = await app.request(`/api/reply-boxes/${first.id}/replies`, {
    cookie,
  });
  assert.equal(restored.status, 200);
  assert.deepEqual((await restored.json()).replies[0].answers, answers);
  assert.equal((await app.request("/api/publishing", { cookie })).status, 404);

  const other = await app.request("/api/reply-boxes", {
    method: "POST",
    body: { title: "Other owner" },
  });
  const otherCookie = other.headers.get("set-cookie").split(";", 1)[0];
  assert.equal(
    (
      await app.request(`/api/reply-boxes/${first.id}/replies`, {
        cookie: otherCookie,
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await app.request(`/api/reply-boxes/${first.id}`, {
        method: "DELETE",
        cookie: otherCookie,
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await app.request(`/api/reply-boxes/${first.id}`, {
        method: "DELETE",
        cookie,
      })
    ).status,
    200,
  );
  assert.equal(
    (await app.request(`/api/reply-boxes/${first.id}/replies`, { cookie }))
      .status,
    404,
  );
});

test("local reply boxes reject malformed and oversized public submissions", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "pvo-local-replies-"));
  const app = await beta(directory);
  t.after(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });
  const created = await app.request("/api/reply-boxes", {
    method: "POST",
    body: { title: "Question" },
  });
  const { id } = await created.json();
  const path = `/api/reply-boxes/${id}/replies`;
  assert.equal(
    (await app.request(path, { method: "POST", body: { answers: [] } })).status,
    400,
  );
  assert.equal(
    (
      await app.request(path, {
        method: "POST",
        body: {
          answers: [
            { name: "Question", type: "text", value: "x".repeat(3000) },
          ],
        },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await app.request(path, {
        method: "POST",
        body: {
          answers: [
            { name: "Question", type: "text", value: "x".repeat(9000) },
          ],
        },
      })
    ).status,
    413,
  );
  const crossOriginOwner = await app.request("/api/reply-boxes", {
    method: "POST",
    body: { title: "Forged" },
    headers: { Origin: "https://another.example" },
  });
  assert.equal(crossOriginOwner.status, 403);
});
