import { validPublicationId } from "../../../server/identity.js";
import { HttpError } from "../../../server/http.js";
import { replyBoxInput, replyInput } from "../../../server/replies/input.js";
import {
  createLocalSessions,
  localBetaDataDirectory,
} from "../local-sessions.mjs";
import { json } from "../http.mjs";
import { readReplyJson } from "./input.mjs";
import { createLocalReplyRepository } from "./repository.mjs";

function publicCors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
  };
}

/** Loopback ownership uses a derived browser-session ID, never the cookie itself. */
export async function createLocalReplyBoxApi({
  sessions: sharedSessions,
  directory = localBetaDataDirectory,
} = {}) {
  const sessions = sharedSessions ?? (await createLocalSessions({ directory }));
  const boxes = await createLocalReplyRepository({ directory });

  async function handle(request, response, pathname, origin) {
    if (!pathname.startsWith("/api/reply-boxes")) return false;
    const match = /^\/api\/reply-boxes\/([^/]+)(?:\/(replies))?$/.exec(
      pathname,
    );
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
        if (
          request.headers.origin !== origin ||
          (site && site !== "same-origin" && site !== "none")
        )
          throw new HttpError(403, "This request must come from the editor.");
      }
      if (pathname === "/api/reply-boxes" && request.method === "POST") {
        const { title } = replyBoxInput(await readReplyJson(request));
        const session = sessions.ensure(request);
        const box = await boxes.create(session.owner, title, origin);
        json(response, 201, box, {
          "Set-Cookie": sessions.cookie(session.token),
        });
        return true;
      }
      if (pathname === "/api/reply-boxes" && request.method === "GET") {
        const session = sessions.from(request);
        if (!session)
          throw new HttpError(401, "Start an editor session first.");
        json(response, 200, { boxes: boxes.list(session.owner, origin) });
        return true;
      }
      if (!match || !validPublicationId(match[1]))
        throw new HttpError(404, "This reply box is unavailable.");
      const id = match[1];
      if (publicReplies && request.method === "POST") {
        const { answers } = replyInput(await readReplyJson(request));
        await boxes.submit(id, answers);
        json(response, 201, { accepted: true }, cors);
        return true;
      }
      const session = sessions.from(request);
      if (!session) throw new HttpError(401, "Start an editor session first.");
      boxes.owned(id, session.owner);
      if (publicReplies && request.method === "GET") {
        json(response, 200, { replies: boxes.replies(id, session.owner) });
        return true;
      }
      if (!publicReplies && request.method === "DELETE") {
        await boxes.remove(id, session.owner);
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

  return { handle, close: boxes.close };
}
