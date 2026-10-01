import assert from "node:assert/strict";
import test from "node:test";
import {
  announceDeployedRelease,
  validateEditorReleaseRevision,
  waitForDeployedRelease,
} from "../scripts/build/wait-for-deployed-release.mjs";

const origin = "https://release.example";
const expected = "restyle-editor-shell-abcdef0123456789";

function clock() {
  let time = 0;
  return {
    now: () => time,
    sleep: async milliseconds => { time += milliseconds; },
  };
}

test("deployment verification waits through a stale Cloudflare asset manifest", async () => {
  const time = clock();
  const revisions = ["restyle-editor-shell-old123", expected];
  const calls = [];
  const result = await waitForDeployedRelease({
    origin,
    revision: expected,
    timeoutMs: 10,
    intervalMs: 2,
    ...time,
    fetch: async (url, options) => {
      calls.push({ url, options });
      return Response.json({ revision: revisions.shift() });
    },
  });

  assert.deepEqual(result, { revision: expected, attempts: 2 });
  assert.equal(calls[0].url.origin, origin);
  assert.equal(calls[0].url.pathname, "/editor/release.json");
  assert.equal(calls[0].url.searchParams.get("expected"), expected);
  assert.equal(calls[0].options.cache, "no-store");
  assert.equal(calls[0].options.headers["Cache-Control"], "no-cache, no-store, max-age=0");
  assert.equal(calls[0].options.redirect, "error");
});

test("deployment verification reports the last stale revision at its deadline", async () => {
  const time = clock();
  await assert.rejects(
    waitForDeployedRelease({
      origin,
      revision: expected,
      timeoutMs: 5,
      intervalMs: 2,
      ...time,
      fetch: async () => Response.json({ revision: "restyle-editor-shell-old123" }),
    }),
    /not served within 5ms \(served restyle-editor-shell-old123\).*No release announced/,
  );
});

test("deployment verification retries network, server and malformed responses", async () => {
  const time = clock();
  const results = [
    new Error("network unavailable"),
    new Response("unavailable", { status: 503 }),
    new Response("not json"),
    Response.json({ revision: expected }),
  ];
  const verified = await waitForDeployedRelease({
    origin,
    revision: expected,
    timeoutMs: 20,
    intervalMs: 2,
    ...time,
    fetch: async () => {
      const result = results.shift();
      if (result instanceof Error) throw result;
      return result;
    },
  });
  assert.equal(verified.attempts, 4);
});

test("deployment verification bounds an adapter that ignores cancellation", async () => {
  let signal;
  await assert.rejects(
    waitForDeployedRelease({
      origin,
      revision: expected,
      timeoutMs: 20,
      intervalMs: 0,
      fetch: async (_url, options) => {
        signal = options.signal;
        return new Promise(() => {});
      },
    }),
    /request timed out.*No release announced/,
  );
  assert.equal(signal.aborted, true);
});

test("deployment verification rejects invalid targets and revisions before fetching", async () => {
  await assert.rejects(
    waitForDeployedRelease({ origin: "http://release.example", revision: expected }),
    /exact HTTPS deployment origin/,
  );
  await assert.rejects(
    waitForDeployedRelease({ origin, revision: "not-a-release" }),
    /valid editor revision/,
  );
  assert.throws(
    () => validateEditorReleaseRevision("restyle-editor-shell-abcdef012345678"),
    /valid editor revision/,
  );
  assert.throws(
    () => validateEditorReleaseRevision("restyle-editor-shell-abcdef01234567890"),
    /valid editor revision/,
  );
});

test("release announcement retries a temporarily mismatched Worker binding", async () => {
  const time = clock();
  const statuses = [409, 429, 503, 204];
  const calls = [];
  const result = await announceDeployedRelease({
    origin,
    revision: expected,
    secret: "release-secret",
    timeoutMs: 20,
    intervalMs: 2,
    ...time,
    fetch: async (url, options) => {
      calls.push({ url, options });
      return new Response(null, { status: statuses.shift() });
    },
  });

  assert.deepEqual(result, { revision: expected, attempts: 4 });
  assert.equal(calls[0].url.pathname, "/api/releases/announce");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers.Authorization, "Bearer release-secret");
  assert.deepEqual(JSON.parse(calls[0].options.body), { revision: expected });
});

test("release announcement fails immediately when authorization is rejected", async () => {
  const time = clock();
  let calls = 0;
  await assert.rejects(
    announceDeployedRelease({
      origin,
      revision: expected,
      secret: "wrong-secret",
      timeoutMs: 20,
      intervalMs: 2,
      ...time,
      fetch: async () => {
        calls += 1;
        return new Response(null, { status: 401 });
      },
    }),
    /announcement was rejected \(401\)/,
  );
  assert.equal(calls, 1);
});

test("release announcement timeout reports that deployment may already be live", async () => {
  const time = clock();
  await assert.rejects(
    announceDeployedRelease({
      origin,
      revision: expected,
      secret: "release-secret",
      timeoutMs: 5,
      intervalMs: 2,
      ...time,
      fetch: async () => new Response(null, { status: 409 }),
    }),
    /Deployment may be live.*not announced within 5ms \(HTTP 409\)/,
  );
});
