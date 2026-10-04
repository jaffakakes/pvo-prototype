import test from "node:test";
import assert from "node:assert/strict";
import { configuration } from "../server/config.js";
import { createAccountSession } from "../server/auth/sessions.js";
import { workerFixture, ORIGIN, SECRET, reserve, upload, tinyMp4 } from "./publishing-server.helpers.mjs";

const expectedStatus = hasSession => ({ available: true, hasSession, maxBytes: 52428800 });

test("publishing availability requires storage, a strong secret and its exact HTTPS origin", () => {
  const env = { PUBLISHING_ENABLED: "true", PUBLIC_ORIGIN: ORIGIN, DB: {}, MEDIA: {}, SESSION_SECRET: SECRET };
  assert.equal(configuration(env, ORIGIN).available, true);
  for (const changes of [
    { PUBLISHING_ENABLED: "false" }, { DB: null }, { MEDIA: null }, { SESSION_SECRET: "short" },
    { PUBLIC_ORIGIN: "http://restyle.example" }, { PUBLIC_ORIGIN: `${ORIGIN}/path` },
  ]) assert.equal(configuration({ ...env, ...changes }, ORIGIN).available, false);
  assert.equal(configuration(env, "https://other.example").available, false);
});

test("publishing status reads an account session without creating one", async () => {
  const f = await workerFixture({}, { createSessions: false });
  try {
    const status = await f.request("/api/publishing");
    assert.deepEqual(await status.json(), expectedStatus(false));
    assert.equal(status.headers.get("Set-Cookie"), null);
    assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM users").first()).count, 0);
    assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM sessions").first()).count, 0);
    assert.equal((await f.request("/api/publishing/session", { method: "POST" })).status, 404);

    const cookie = (await createAccountSession({ sub: "status-test-subject", name: "Creator" },
      { DB: f.db, SESSION_SECRET: SECRET })).split(";", 1)[0];
    const signedIn = await f.request("/api/publishing", { session: cookie });
    assert.deepEqual(await signedIn.json(), expectedStatus(true));
    assert.equal(signedIn.headers.get("Set-Cookie"), null);
  } finally { await f.close(); }
});

test("an expired account session loses management; signing in again recovers its links", async () => {
  const f = await workerFixture();
  try {
    const file = tinyMp4();
    const published = await reserve(f, file);
    assert.equal((await upload(f, published.body.id, file)).status, 200);
    const user = (await (await f.request("/api/auth/session")).json()).user;
    assert.equal(typeof user.id, "string");
    for (const session of [null, "__Host-pvo-session=forged"]) {
      assert.deepEqual(await (await f.request("/api/publishing", { session })).json(), expectedStatus(false));
      assert.equal((await f.request("/api/publications", { session })).status, 401);
      assert.equal((await f.request(`/api/publications/${published.body.id}`, { method: "DELETE", session })).status, 401);
    }
    await f.db.prepare("UPDATE sessions SET expires_at = 1 WHERE user_id = ?").bind(user.id).run();
    assert.deepEqual(await (await f.request("/api/publishing")).json(), expectedStatus(false));
    assert.equal((await reserve(f, file)).response.status, 401);

    const renewed = (await createAccountSession({ sub: "fixture-google-subject-1", name: "First creator" },
      { DB: f.db, SESSION_SECRET: SECRET })).split(";", 1)[0];
    assert.notEqual(renewed, f.cookie);
    const listing = await (await f.request("/api/publications", { session: renewed })).json();
    assert.deepEqual(listing.publications.map(item => item.id), [published.body.id]);
    assert.equal((await f.request(`/media/${published.body.id}`, { session: null })).status, 200);
  } finally { await f.close(); }
});

test("Google accounts have separate publication ownership while viewing remains public", async () => {
  const f = await workerFixture();
  try {
    assert.notEqual(f.cookie, f.otherCookie);
    const file = tinyMp4();
    const first = await reserve(f, file);
    await upload(f, first.body.id, file);
    const second = await reserve(f, file, first.input, { session: f.otherCookie });
    assert.notEqual(second.body.id, first.body.id);
    await upload(f, second.body.id, file, { session: f.otherCookie });
    assert.deepEqual((await (await f.request("/api/publications")).json()).publications.map(item => item.id), [first.body.id]);
    assert.deepEqual((await (await f.request("/api/publications", { session: f.otherCookie })).json()).publications.map(item => item.id), [second.body.id]);
    assert.equal((await f.request(`/api/publications/${first.body.id}`, { method: "DELETE", session: f.otherCookie })).status, 404);
    assert.equal((await f.request(`/player/${first.body.id}`, { session: null })).status, 200);
    assert.equal((await f.request(`/media/${first.body.id}`, { session: null })).status, 200);
  } finally { await f.close(); }
});
