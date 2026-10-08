import {
  accountConnectionRoute,
  isAccountConnectionRoute,
} from "./connections/routes.js";
import { hostedServiceRoute, isServiceRoute } from "./cloud-services/routes.js";
import { configuration } from "./config.js";
import { releaseRoute } from "./releases/routes.js";
import { HttpError, json, notFound } from "./http.js";
import { validPublicationId } from "./identity.js";
import { publishingRoute } from "./publishing/routes.js";
import { cleanupPublications } from "./publishing/cleanup.js";
import { nativeAssistantRoute } from "./assistant/native/routes.js";
import { assistantTaskRoute, isTaskRoute } from "./assistant/tasks/routes.js";
import { fontsRoute } from "./fonts/routes.js";
import { webRoute } from "./web/routes.js";
import { imessageRoute } from "./imessage/routes.js";
import { cleanupAccountSessions } from "./auth/sessions.js";
import { readMedia, readPoster, viewPublication } from "./viewing/routes.js";
import { renderRoute } from "./render-jobs/routes.js";
import { processRenderQueue } from "./render-jobs/queue.js";
import { cleanupRenders } from "./render-jobs/cleanup.js";
import {
  isPublicReplyRequest,
  publicReplyCors,
  replyBoxRoute,
} from "./replies/routes.js";
import { cleanupReplyBoxes } from "./replies/repository.js";
import { authRoute } from "./auth/routes.js";

export async function handleRequest(request, env) {
  const url = new URL(request.url);
  const config = configuration(env, url.origin);
  try {
    if (isAccountConnectionRoute(url.pathname))
      return await accountConnectionRoute(request, env, config);
    if (isServiceRoute(url.pathname))
      return await hostedServiceRoute(request, env, config);
    if (url.pathname.startsWith("/api/web/")) return await webRoute(request);
    if (url.pathname.startsWith("/api/imessage/"))
      return await imessageRoute(request, env);
    if (url.pathname.startsWith("/api/fonts/"))
      return await fontsRoute(request);
    if (isTaskRoute(url.pathname))
      return await assistantTaskRoute(request, env, config);
    if (url.pathname.startsWith("/api/assistant/"))
      return await nativeAssistantRoute(request, env, config);
    if (url.pathname === "/api/auth" || url.pathname.startsWith("/api/auth/"))
      return await authRoute(request, env, config);
    if (
      url.pathname === "/api/renders" ||
      url.pathname.startsWith("/api/renders/")
    )
      return await renderRoute(request, env, config);
    if (url.pathname.startsWith("/api/releases/"))
      return await releaseRoute(request, env);
    if (
      url.pathname === "/api/reply-boxes" ||
      url.pathname.startsWith("/api/reply-boxes/")
    )
      return await replyBoxRoute(request, env, config);
    if (
      url.pathname === "/api/publishing" ||
      url.pathname === "/api/publications" ||
      url.pathname.startsWith("/api/publications/")
    )
      return await publishingRoute(request, env, config);
    if (url.pathname === "/api" || url.pathname.startsWith("/api/"))
      return notFound();
    if (request.method !== "GET" && request.method !== "HEAD")
      throw new HttpError(405, "This operation is not supported.");
    if (url.pathname === "/")
      return Response.redirect(`${url.origin}/editor/?home=1`, 302);
    if (/^\/(?:docs|demo)(?:\/|$)/.test(url.pathname)) return notFound();
    const media = /^\/media\/([^/]+)$/.exec(url.pathname);
    if (media) return await readMedia(request, env, media[1]);
    if (url.pathname === "/media" || url.pathname.startsWith("/media/"))
      return notFound();
    const poster = /^\/poster\/([^/]+)$/.exec(url.pathname);
    if (poster) return await readPoster(request, env, poster[1]);
    if (url.pathname === "/poster" || url.pathname.startsWith("/poster/"))
      return notFound();
    const player = /^\/player\/([^/]+)$/.exec(url.pathname);
    if (player && validPublicationId(player[1]))
      return await viewPublication(request, env, player[1]);
    if (
      url.pathname === "/player/published.html" ||
      url.pathname === "/player/published"
    )
      return notFound();
    if (player && !/\.(?:html|js|css|woff2)$/.test(player[1]))
      return notFound();
    return await env.ASSETS.fetch(request);
  } catch (error) {
    if (!(error instanceof HttpError))
      console.error(
        "Restyle request failed",
        request.method,
        url.pathname,
        error?.name,
      );
    const response = json(
      {
        error:
          error instanceof HttpError
            ? error.message
            : "This operation could not finish. Please retry.",
      },
      error instanceof HttpError ? error.status : 500,
    );
    return isPublicReplyRequest(request, url.pathname)
      ? publicReplyCors(response)
      : response;
  }
}

export default {
  fetch: handleRequest,
  queue: processRenderQueue,
  async scheduled(_event, env) {
    await cleanupAccountSessions(env);
    await cleanupPublications(env);
    await cleanupRenders(env);
    await cleanupReplyBoxes(env.DB);
  },
};
