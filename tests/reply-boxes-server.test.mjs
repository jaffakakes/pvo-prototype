import test from "node:test";
import assert from "node:assert/strict";
import { workerFixture, ORIGIN, SECRET } from "./publishing-server.helpers.mjs";
import { cleanupReplyBoxes, MAX_BOXES_PER_OWNER } from "../server/replies/repository.js";
import { replySourceHash } from "../server/replies/source.js";
import { createAccountSession } from "../server/auth/sessions.js";

const answers = [
  { name: "Your message", type: "text", value: "Could we talk?" },
  { name: "Follow up", type: "yesno", value: false },
];

async function createBox(fixture, title = "Questions") {
  const response = await fixture.request("/api/reply-boxes", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) });
  return { response, body: await response.json() };
}

async function sendReply(fixture, id, body = { answers }, options = {}) {
  return fixture.request(`/api/reply-boxes/${id}/replies`, { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), session: null, ...options });
}

test("signed-in owners create boxes, read only their inbox, and remove the collection", async () => {
  const fixture = await workerFixture();
  try {
    assert.equal((await createBox(fixture, "My inbox")).response.status, 201);
    const { body: box } = await createBox(fixture);
    assert.match(box.id, /^[A-Za-z0-9_-]{22}$/);
    assert.equal(box.url, `${ORIGIN}/api/reply-boxes/${box.id}/replies`);
    assert.equal(box.title, "Questions");
    assert.equal((await fixture.request("/api/reply-boxes", { method: "POST", session: null,
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "Other" }),
    })).status, 401);

    const list = await (await fixture.request("/api/reply-boxes")).json();
    assert.equal(list.boxes.length, 2);
    assert.deepEqual(list.boxes.find(item => item.id === box.id), {
      id: box.id, title: "Questions", createdAt: list.boxes.find(item => item.id === box.id).createdAt,
      count: 0, url: box.url,
    });
    assert.equal((await (await fixture.request("/api/reply-boxes", { session: fixture.otherCookie })).json()).boxes.length, 0);
    const sameAccountCookie = (await createAccountSession({ sub: "fixture-google-subject-1", name: "First creator" },
      { DB: fixture.db, SESSION_SECRET: SECRET })).split(";", 1)[0];
    assert.equal((await (await fixture.request("/api/reply-boxes", { session: sameAccountCookie })).json()).boxes.length, 2);
    assert.equal((await fixture.request(`/api/reply-boxes/${box.id}/replies`, { session: fixture.otherCookie })).status, 404);
    assert.equal((await fixture.request(`/api/reply-boxes/${box.id}`, {
      method: "DELETE", session: fixture.otherCookie,
    })).status, 404);

    const submitted = await sendReply(fixture, box.id);
    assert.equal(submitted.status, 201, await submitted.clone().text());
    assert.deepEqual(await submitted.json(), { accepted: true });
    const inbox = await (await fixture.request(`/api/reply-boxes/${box.id}/replies`)).json();
    assert.equal(inbox.replies.length, 1);
    assert.match(inbox.replies[0].id, /^[A-Za-z0-9_-]{22}$/);
    assert.deepEqual(inbox.replies[0].answers, answers);
    assert.equal(new Date(inbox.replies[0].createdAt).toISOString(), inbox.replies[0].createdAt);
    assert.equal((await fixture.request(`/api/reply-boxes/${box.id}/replies`, { session: null })).status, 401);

    assert.equal((await fixture.request(`/api/reply-boxes/${box.id}`, {
      method: "DELETE", headers: { Origin: "https://elsewhere.example" },
    })).status, 403);
    assert.equal((await fixture.request(`/api/reply-boxes/${box.id}`, { method: "DELETE" })).status, 200);
    assert.equal((await sendReply(fixture, box.id)).status, 404);
    assert.equal((await fixture.db.prepare("SELECT COUNT(*) AS count FROM replies WHERE box_id = ?")
      .bind(box.id).first()).count, 0);
  } finally { await fixture.close(); }
});

test("public submissions work across origins with preflight and CORS on errors", async () => {
  const fixture = await workerFixture();
  try {
    const { body: box } = await createBox(fixture);
    const path = `/api/reply-boxes/${box.id}/replies`;
    const preflight = await fixture.request(path, { method: "OPTIONS", session: null,
      headers: { Origin: "https://external-player.example", "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type" } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), "*");
    assert.match(preflight.headers.get("Access-Control-Allow-Methods"), /POST/);
    const submitted = await sendReply(fixture, box.id, { answers }, {
      headers: { Origin: "https://external-player.example", "Content-Type": "application/json" },
    });
    assert.equal(submitted.status, 201);
    assert.equal(submitted.headers.get("Access-Control-Allow-Origin"), "*");
    const invalid = await sendReply(fixture, box.id, { answers: [] }, {
      headers: { Origin: "https://external-player.example", "Content-Type": "application/json" },
    });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.headers.get("Access-Control-Allow-Origin"), "*");
    const ownerOnly = await fixture.request(path, { session: fixture.otherCookie,
      headers: { Origin: "https://external-player.example" } });
    assert.equal(ownerOnly.status, 404);
    assert.equal(ownerOnly.headers.get("Access-Control-Allow-Origin"), null);
  } finally { await fixture.close(); }
});

test("reply input and boxes are bounded; trusted edge source is rate-limited without storing an address", async () => {
  const fixture = await workerFixture();
  try {
    assert.equal((await createBox(fixture, " ")).response.status, 400);
    const { body: box } = await createBox(fixture);
    assert.equal((await sendReply(fixture, box.id, { answers: [
      { name: "Message", type: "text", value: "x".repeat(1025) },
    ] })).status, 400);
    assert.equal((await sendReply(fixture, box.id, { answers: [
      { name: "Message", type: "text", value: "" },
    ] })).status, 400);
    assert.equal((await sendReply(fixture, box.id, { answers: [
      { name: "Answer", type: "number", value: "NaN" },
    ] })).status, 400);
    assert.equal((await sendReply(fixture, box.id, { answers: [
      { name: " Message ", type: "text", value: "Hello" },
    ] })).status, 201);
    const noIp = await fixture.db.prepare("SELECT source_hash, answers_json FROM replies WHERE box_id = ?")
      .bind(box.id).first();
    assert.equal(JSON.parse(noIp.answers_json)[0].name, "Message");
    assert.equal(await replySourceHash(new Request(ORIGIN), SECRET, box.id), null);
    assert.equal((await sendReply(fixture, box.id, { answers: Array.from({ length: 6 }, () => answers[0]) })).status, 400);
    const edgeHeaders = { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.5" };
    for (let index = 0; index < 10; index += 1) {
      const reply = await sendReply(fixture, box.id, { answers }, { headers: edgeHeaders });
      assert.equal(reply.status, 201, `submission ${index + 1}: ${await reply.clone().text()}`);
    }
    const limited = await sendReply(fixture, box.id, { answers }, { headers: edgeHeaders });
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("Access-Control-Allow-Origin"), "*");
    assert.equal((await sendReply(fixture, box.id, { answers }, {
      headers: { ...edgeHeaders, "CF-Connecting-IP": "203.0.113.6" },
    })).status, 201);
    const stored = await fixture.db.prepare("SELECT DISTINCT source_hash FROM replies WHERE box_id = ?")
      .bind(box.id).all();
    assert.equal(stored.results.length, 3);
    assert(stored.results.every(row => !row.source_hash.includes("203.0.113")));
    assert.equal((await fixture.request("/api/reply-boxes", { method: "POST",
      headers: { Origin: "https://elsewhere.example", "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Cross-site" }),
    })).status, 403);
  } finally { await fixture.close(); }
});

test("box quota and expiry release storage and stop collection", async () => {
  const fixture = await workerFixture();
  try {
    const { body: box } = await createBox(fixture);
    await sendReply(fixture, box.id);
    await fixture.db.prepare("UPDATE reply_boxes SET expires_at = 1 WHERE id = ?").bind(box.id).run();
    assert.equal((await sendReply(fixture, box.id)).status, 404);
    await cleanupReplyBoxes(fixture.db);
    assert.equal((await fixture.db.prepare("SELECT COUNT(*) AS count FROM replies WHERE box_id = ?")
      .bind(box.id).first()).count, 0);
    assert.equal((await fixture.db.prepare("SELECT COUNT(*) AS count FROM reply_boxes WHERE id = ?")
      .bind(box.id).first()).count, 0);
    for (let index = 0; index < MAX_BOXES_PER_OWNER; index += 1) {
      const response = await createBox(fixture, `Box ${index + 1}`);
      assert.equal(response.response.status, 201);
    }
    assert.equal((await createBox(fixture, "One too many")).response.status, 429);
  } finally { await fixture.close(); }
});
