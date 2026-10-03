import { checkOrigin, HttpError, json, notFound, readJson } from "../http.js";
import { testConsent, testRecipient, TEST_MESSAGE } from "./phone.js";

// The editor's request deadline is 15 seconds. Leave time for the response to arrive.
const POLL_TIMEOUT = 12_000;

async function authorized(request, token) {
  if (typeof token !== "string" || token.length < 32) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(token), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`Bearer ${token}`));
  return crypto.subtle.verify("HMAC", key, signature, encoder.encode(request.headers.get("Authorization") || ""));
}

async function recipientKey(phone, token) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(token), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(phone));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function queue(env) {
  if (!env.IMESSAGE_TEST_QUEUE || !env.IMESSAGE_BRIDGE_TOKEN)
    throw new HttpError(503, "The test iMessage sender is unavailable.");
  return env.IMESSAGE_TEST_QUEUE.getByName("beta");
}

export async function imessageRoute(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!["/api/imessage/status", "/api/imessage/test", "/api/imessage/next", "/api/imessage/result"].includes(path))
    return notFound();
  const sender = queue(env);

  if (path === "/api/imessage/status") {
    if (request.method !== "GET") throw new HttpError(405, "Use GET.");
    return json(await sender.status());
  }

  if (path === "/api/imessage/test") {
    if (request.method !== "POST") throw new HttpError(405, "Use POST.");
    checkOrigin(request, url.origin);
    const input = await readJson(request, 1024);
    testConsent(input?.consent);
    const phone = testRecipient(input?.phone);
    const placed = await sender.enqueue(phone, await recipientKey(phone, env.IMESSAGE_BRIDGE_TOKEN));
    if (placed.status === "offline") throw new HttpError(503, "The Mac Messages sender is offline. Try again when it is open.");
    if (placed.status === "limit") throw new HttpError(429, "The test message limit has been reached today.");
    const deadline = Date.now() + POLL_TIMEOUT;
    while (Date.now() < deadline && !request.signal.aborted) {
      const status = await sender.result(placed.id);
      if (status === "sent") return json({ sent: true });
      if (status === "failed") throw new HttpError(502, "Messages could not send the test message. Check the Mac sender.");
      if (status === "expired") throw new HttpError(504, "The Mac did not collect the test message in time.");
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    return json({ pending: true }, 202);
  }

  if (!await authorized(request, env.IMESSAGE_BRIDGE_TOKEN)) throw new HttpError(401, "Mac sender authorization required.");
  if (path === "/api/imessage/next") {
    if (request.method !== "GET") throw new HttpError(405, "Use GET.");
    const job = await sender.claim();
    return job ? json({ job: { ...job, text: TEST_MESSAGE } }) : new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  }
  if (request.method !== "POST") throw new HttpError(405, "Use POST.");
  const result = await readJson(request, 256);
  if (typeof result?.id !== "string" || !/^[0-9a-f-]{36}$/.test(result.id) || typeof result?.sent !== "boolean")
    throw new HttpError(400, "Invalid message result.");
  if (!await sender.finish(result.id, result.sent)) throw new HttpError(409, "This message is no longer pending.");
  return json({ recorded: true });
}
