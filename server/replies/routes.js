import { checkOrigin, HttpError, json, readJson } from "../http.js";
import { getAccountSession } from "../auth/sessions.js";
import { replyBoxInput, replyInput } from "./input.js";
import { replySourceHash } from "./source.js";
import {
  createReplyBox, ownerReplyBoxes, ownerReplies, removeReplyBox, submitReply,
} from "./repository.js";

const replyPath = /^\/api\/reply-boxes\/([^/]+)\/replies$/;
const validId = id => /^[A-Za-z0-9_-]{22}$/.test(id);

export function isPublicReplyRequest(request, pathname) {
  return (request.method === "POST" || request.method === "OPTIONS") && replyPath.test(pathname);
}

export function publicReplyCors(response) {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type");
  response.headers.set("Access-Control-Max-Age", "600");
  return response;
}

export async function replyBoxRoute(request, env, config) {
  if (!config.available) throw new HttpError(503, "Collect replies is not available yet.");
  const path = new URL(request.url).pathname;
  const match = /^\/api\/reply-boxes\/([^/]+)(\/replies)?$/.exec(path);
  if (match && !validId(match[1])) throw new HttpError(404, "This reply box is unavailable.");

  if (match?.[2] === "/replies" && request.method === "OPTIONS") {
    return publicReplyCors(new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } }));
  }
  if (match?.[2] === "/replies" && request.method === "POST") {
    const { answers } = replyInput(await readJson(request));
    const sourceHash = await replySourceHash(request, env.SESSION_SECRET, match[1]);
    await submitReply(env.DB, match[1], answers, sourceHash);
    return publicReplyCors(json({ accepted: true }, 201));
  }

  if (request.method !== "GET") checkOrigin(request, config.origin);
  const owner = await getAccountSession(request, env);
  if (!owner) throw new HttpError(401, "Sign in to manage or create reply boxes.");
  if (path === "/api/reply-boxes") {
    if (request.method === "POST") {
      const { title } = replyBoxInput(await readJson(request));
      return json(await createReplyBox(env.DB, owner.id, title, config.origin), 201);
    }
    if (request.method === "GET")
      return json({ boxes: await ownerReplyBoxes(env.DB, owner.id, config.origin) });
  }
  if (match && match[2] === "/replies" && request.method === "GET")
    return json({ replies: await ownerReplies(env.DB, match[1], owner.id) });
  if (match && !match[2] && request.method === "DELETE") {
    await removeReplyBox(env.DB, match[1], owner.id);
    return json({ deleted: true });
  }
  throw new HttpError(405, "This reply box operation is not supported.");
}
