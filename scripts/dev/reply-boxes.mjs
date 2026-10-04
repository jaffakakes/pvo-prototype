import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { HttpError } from "../../server/http.js";
import { replyBoxInput, replyInput } from "../../server/replies/input.js";
import { createLocalSessions, localBetaDataDirectory } from "./local-sessions.mjs";

const BOX_ID = /^[A-Za-z0-9_-]{22}$/;
const MAX_BODY_BYTES = 8 * 1024;
const MAX_BOXES_PER_OWNER = 20;
const MAX_TOTAL_BOXES = 200;
const MAX_REPLIES_PER_BOX = 1000;
const MAX_REPLIES_PER_BOX_DAY = 200;
const MAX_REPLIES_PER_BOX_MINUTE = 30;
const BOX_LIFETIME_MS = 180 * 24 * 60 * 60 * 1000;

function json(response, status, data, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  response.end(JSON.stringify(data));
}

function publicCors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
  };
}

async function readJson(request) {
  if (request.headers["content-type"]?.split(";", 1)[0].trim() !== "application/json")
    throw new HttpError(415, "Send application/json.");
  const declared = Number(request.headers["content-length"]);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES)
    throw new HttpError(413, "This request is too large.");
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > MAX_BODY_BYTES) throw new HttpError(413, "This request is too large.");
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new HttpError(400, "Send valid JSON."); }
}

async function readStoredBoxes(path) {
  let source;
  try { source = await readFile(path, "utf8"); }
  catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const parsed = JSON.parse(source);
  if (!Array.isArray(parsed) || parsed.some(box => !BOX_ID.test(box?.id ?? "")
    || typeof box.owner !== "string" || !Number.isSafeInteger(box.expiresAt)
    || !Array.isArray(box.replies)))
    throw new Error("The local reply-box store is invalid.");
  return parsed;
}

function publicBox(box, origin, withCount = false) {
  return {
    id: box.id,
    url: `${origin}/api/reply-boxes/${box.id}/replies`,
    title: box.title,
    ...(withCount ? { createdAt: box.createdAt, count: box.replies.length } : {}),
  };
}

function freshBoxes(boxes) {
  const now = Date.now();
  return boxes.filter(box => box.expiresAt > now);
}

/** Disk-backed beta adapter; creator ownership is a derived session ID, never a cookie. */
export async function createLocalReplyBoxApi({ sessions: sharedSessions, directory = localBetaDataDirectory } = {}) {
  const sessions = sharedSessions ?? await createLocalSessions({ directory });
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, "reply-boxes.json");
  let boxes = await readStoredBoxes(path);
  let writes = Promise.resolve();

  function mutate(change) {
    const pending = writes.then(async () => {
      const next = structuredClone(freshBoxes(boxes));
      const result = change(next);
      const temporary = join(directory, `.reply-boxes-${randomBytes(8).toString("hex")}.tmp`);
      try {
        await writeFile(temporary, JSON.stringify(next), { flag: "wx", mode: 0o600 });
        await rename(temporary, path);
      } finally {
        await rm(temporary, { force: true });
      }
      boxes = next;
      return result;
    });
    writes = pending.catch(() => {});
    return pending;
  }

  if (freshBoxes(boxes).length !== boxes.length) await mutate(() => {});
  const cleanup = setInterval(() => {
    if (freshBoxes(boxes).length !== boxes.length)
      void mutate(() => {}).catch(error => console.error("Local reply-box cleanup failed:", error));
  }, 60 * 60 * 1000);
  cleanup.unref();

  async function handle(request, response, pathname, origin) {
    if (!pathname.startsWith("/api/reply-boxes")) return false;
    const match = /^\/api\/reply-boxes\/([^/]+)(?:\/(replies))?$/.exec(pathname);
    const publicReplies = match?.[2] === "replies";
    const cors = publicReplies ? publicCors() : {};
    if (publicReplies && request.method === "OPTIONS") {
      response.writeHead(204, { "Cache-Control": "no-store", ...cors });
      response.end();
      return true;
    }
    try {
      if (request.method !== "GET" && !publicReplies) {
        const site = request.headers["sec-fetch-site"];
        if (request.headers.origin !== origin || site && site !== "same-origin" && site !== "none")
          throw new HttpError(403, "This request must come from the editor.");
      }
      if (pathname === "/api/reply-boxes" && request.method === "POST") {
        const { title } = replyBoxInput(await readJson(request));
        const session = sessions.ensure(request);
        const box = await mutate(next => {
          if (next.length >= MAX_TOTAL_BOXES || next.filter(item => item.owner === session.owner).length >= MAX_BOXES_PER_OWNER)
            throw new HttpError(429, "The reply-box limit has been reached.");
          const now = Date.now();
          const created = { id: randomBytes(16).toString("base64url"), owner: session.owner,
            title, createdAt: new Date(now).toISOString(), expiresAt: now + BOX_LIFETIME_MS, replies: [] };
          next.push(created);
          return created;
        });
        json(response, 201, publicBox(box, origin), { "Set-Cookie": sessions.cookie(session.token) });
        return true;
      }
      if (pathname === "/api/reply-boxes" && request.method === "GET") {
        const session = sessions.from(request);
        if (!session) throw new HttpError(401, "Start an editor session first.");
        json(response, 200, { boxes: freshBoxes(boxes).filter(box => box.owner === session.owner)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map(box => publicBox(box, origin, true)) });
        return true;
      }
      if (!match || !BOX_ID.test(match[1])) throw new HttpError(404, "This reply box is unavailable.");
      const id = match[1];
      if (publicReplies && request.method === "POST") {
        const { answers } = replyInput(await readJson(request));
        await mutate(next => {
          const box = next.find(item => item.id === id);
          if (!box) throw new HttpError(404, "This reply box is unavailable.");
          const now = Date.now();
          const recentDay = box.replies.filter(reply => Date.parse(reply.createdAt) >= now - 86_400_000).length;
          const recentMinute = box.replies.filter(reply => Date.parse(reply.createdAt) >= now - 60_000).length;
          if (box.replies.length >= MAX_REPLIES_PER_BOX || recentDay >= MAX_REPLIES_PER_BOX_DAY
            || recentMinute >= MAX_REPLIES_PER_BOX_MINUTE)
            throw new HttpError(429, "This reply box is receiving too many messages. Try again later.");
          box.replies.push({ id: randomBytes(16).toString("base64url"), answers, createdAt: new Date(now).toISOString() });
        });
        json(response, 201, { accepted: true }, cors);
        return true;
      }
      const session = sessions.from(request);
      if (!session) throw new HttpError(401, "Start an editor session first.");
      const owned = freshBoxes(boxes).find(box => box.id === id && box.owner === session.owner);
      if (!owned) throw new HttpError(404, "This reply box is unavailable.");
      if (publicReplies && request.method === "GET") {
        json(response, 200, { replies: [...owned.replies].reverse() });
        return true;
      }
      if (!publicReplies && request.method === "DELETE") {
        await mutate(next => { next.splice(next.findIndex(box => box.id === id && box.owner === session.owner), 1); });
        json(response, 200, { deleted: true });
        return true;
      }
      throw new HttpError(405, "This reply-box operation is not supported.");
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
      json(response, error.status, { error: error.message }, cors);
      return true;
    }
  }

  async function close() { clearInterval(cleanup); await writes; }
  return { handle, close };
}
