import { json, checkOrigin, HttpError } from "../http.js";
import {
  createAccountSession,
  endAccountSession,
  getAccountSession,
} from "./sessions.js";
import { supabaseIdentityFromRequest } from "./supabase.js";

export async function authRoute(request, env, config, fetcher = fetch) {
  const url = new URL(request.url);
  if (url.pathname === "/api/auth/session") {
    if (request.method !== "GET")
      throw new HttpError(405, "This sign-in operation is not supported.");
    const user =
      config.origin === url.origin
        ? await getAccountSession(request, env)
        : null;
    return json({
      available: config.authAvailable,
      supabaseAvailable: config.supabaseAvailable,
      supabaseUrl: config.supabaseUrl,
      supabasePublishableKey: config.supabaseAvailable
        ? env.SUPABASE_PUBLISHABLE_KEY
        : null,
      user,
    });
  }
  if (url.pathname === "/api/auth/supabase/exchange") {
    if (request.method !== "POST")
      throw new HttpError(405, "This sign-in operation is not supported.");
    if (!config.supabaseAvailable)
      throw new HttpError(503, "Sign-in is not configured here yet.");
    checkOrigin(request, config.origin);
    const identity = await supabaseIdentityFromRequest(
      request,
      config.supabaseUrl,
      env.SUPABASE_PUBLISHABLE_KEY,
      fetcher,
    );
    const { user, cookie } = await createAccountSession(identity, env);
    return json({ user }, 200, { "Set-Cookie": cookie });
  }
  if (url.pathname === "/api/auth/logout") {
    if (request.method !== "POST")
      throw new HttpError(405, "This sign-in operation is not supported.");
    checkOrigin(request, config.origin);
    return json({ user: null }, 200, {
      "Set-Cookie": await endAccountSession(request, env),
    });
  }
  throw new HttpError(404, "This sign-in route does not exist.");
}
