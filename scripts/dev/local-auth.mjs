import { createLocalAuthStore } from "./local-auth-store.mjs";
import { loadLocalSupabase } from "./local-supabase.mjs";

import { supabaseIdentityFromRequest } from "../../server/auth/supabase.js";

function json(response, status, value, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  response.end(JSON.stringify(value));
}

function error(response, status, message) {
  json(response, status, { error: message });
}

/** Account routes for the HTTP loopback beta; no D1 or Worker bindings. */
export async function createLocalAuthApi({
  directory,
  origin,
  supabasePublishableKey,
  supabaseUrl,
  fetcher = fetch,
}) {
  const base = new URL(origin);
  if (
    base.origin !== origin ||
    base.protocol !== "http:" ||
    base.hostname !== "127.0.0.1"
  )
    throw new Error(
      "Local sign-in requires a canonical http://127.0.0.1 origin.",
    );
  const supabase = await loadLocalSupabase(
    directory,
    supabasePublishableKey,
    supabaseUrl,
    fetcher,
  );
  const store = await createLocalAuthStore(directory);
  const supabaseAvailable = Boolean(supabase);
  const available = supabaseAvailable;

  async function userFor(request) {
    return supabaseAvailable ? store.userFor(request) : null;
  }

  async function handle(request, response, pathname) {
    if (!pathname.startsWith("/api/auth/")) return false;
    if (
      request.headers.host !== base.host ||
      new URL(request.url, origin).origin !== origin
    )
      return error(response, 400, "This sign-in address is invalid.");
    if (pathname === "/api/auth/session") {
      if (request.method !== "GET")
        return error(response, 405, "This sign-in operation is not supported.");
      return json(response, 200, {
        available,
        supabaseAvailable,
        supabasePublishableKey: supabase?.publishableKey ?? null,
        supabaseUrl: supabase?.url ?? null,
        user: await userFor(request),
      });
    }
    if (pathname === "/api/auth/supabase/exchange") {
      if (request.method !== "POST")
        return error(response, 405, "This sign-in operation is not supported.");
      if (!supabaseAvailable)
        return error(
          response,
          503,
          "Email sign-in is not configured here yet.",
        );
      if (
        request.headers.origin !== origin ||
        (request.headers["sec-fetch-site"] &&
          !["same-origin", "none"].includes(request.headers["sec-fetch-site"]))
      )
        return error(
          response,
          403,
          "This operation must start from the editor.",
        );
      const authorization = request.headers.authorization;
      const token =
        typeof authorization === "string" &&
        /^Bearer ([A-Za-z0-9._-]+)$/.exec(authorization)?.[1];
      if (!token || token.length > 16384)
        return error(response, 401, "Email sign-in could not be verified.");
      try {
        const identity = await supabaseIdentityFromRequest(
          new Request(origin, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          supabase.url,
          supabase.publishableKey,
          fetcher,
        );
        const sessionCookie = await store.startSupabaseSession(identity);
        return json(
          response,
          200,
          { user: await store.userFor({ headers: { cookie: sessionCookie } }) },
          { "Set-Cookie": sessionCookie },
        );
      } catch (cause) {
        console.error("Local Supabase sign-in exchange failed:", cause?.name);
        return error(response, 401, "Email sign-in could not be verified.");
      }
    }
    if (pathname === "/api/auth/logout") {
      if (request.method !== "POST")
        return error(response, 405, "This sign-in operation is not supported.");
      if (
        request.headers.origin !== origin ||
        (request.headers["sec-fetch-site"] &&
          !["same-origin", "none"].includes(request.headers["sec-fetch-site"]))
      )
        return error(
          response,
          403,
          "This operation must start from the editor.",
        );
      return json(
        response,
        200,
        { user: null },
        { "Set-Cookie": await store.endSession(request) },
      );
    }
    return error(response, 404, "This sign-in route does not exist.");
  }

  return { handle, userFor };
}
