import { json, checkOrigin, HttpError, escapeHtml } from "../http.js";
import { randomId, digest } from "../identity.js";
import { cookieValue, signCookie, verifyCookie, setCookie } from "./tokens.js";
import { createAccountSession, endAccountSession, getAccountSession } from "./sessions.js";
import { exchangeGoogleCode } from "./google.js";

const STATE_COOKIE = "__Host-pvo-oauth";
const STATE_SECONDS = 10 * 60;

function completion(origin, ok, sessionCookie) {
  const nonce = randomId();
  const scriptOrigin = JSON.stringify(origin).replaceAll("<", "\\u003c");
  const html = `<!doctype html><meta charset="utf-8"><title>PVO sign-in</title>
    <p>${ok ? "Signed in. You can return to your video." : "Sign-in could not finish. Return to your video and try again."}</p>
    <a href="${escapeHtml(origin)}/editor/">Return to PVO</a>
    <script nonce="${nonce}">if(window.opener){window.opener.postMessage({type:"pvo:auth:complete",ok:${ok}},${scriptOrigin});window.close();}</script>`;
  const headers = new Headers({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
    "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`,
    "Referrer-Policy": "no-referrer" });
  headers.append("Set-Cookie", setCookie(STATE_COOKIE, "", 0));
  if (sessionCookie) headers.append("Set-Cookie", sessionCookie);
  return new Response(html, { status: ok ? 200 : 400, headers });
}

export async function authRoute(request, env, config, fetcher = fetch) {
  const url = new URL(request.url);
  if (url.pathname === "/api/auth/session") {
    if (request.method !== "GET") throw new HttpError(405, "This sign-in operation is not supported.");
    const user = config.origin === url.origin ? await getAccountSession(request, env) : null;
    return json({ available: config.authAvailable, user });
  }
  if (url.pathname === "/api/auth/google/start") {
    if (request.method !== "GET") throw new HttpError(405, "This sign-in operation is not supported.");
    if (!config.authAvailable) throw new HttpError(503, "Google sign-in is not configured here yet.");
    const state = randomId(32);
    const nonce = randomId(32);
    const verifier = randomId(32);
    const cookie = await signCookie({ state, nonce, verifier }, env.SESSION_SECRET, "oauth", STATE_SECONDS);
    const destination = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    destination.search = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, response_type: "code",
      scope: "openid profile", redirect_uri: `${config.origin}/api/auth/google/callback`, state, nonce,
      code_challenge: await digest(verifier), code_challenge_method: "S256", prompt: "select_account" }).toString();
    return new Response(null, { status: 302, headers: { Location: destination.href, "Cache-Control": "no-store",
      "Set-Cookie": setCookie(STATE_COOKIE, cookie, STATE_SECONDS), "Referrer-Policy": "no-referrer" } });
  }
  if (url.pathname === "/api/auth/google/callback") {
    if (request.method !== "GET") throw new HttpError(405, "This sign-in operation is not supported.");
    if (!config.authAvailable) throw new HttpError(503, "Google sign-in is not configured here yet.");
    try {
      const state = await verifyCookie(cookieValue(request, STATE_COOKIE), env.SESSION_SECRET, "oauth");
      const codes = url.searchParams.getAll("code");
      const states = url.searchParams.getAll("state");
      if (!state || states.length !== 1 || states[0] !== state.state || codes.length !== 1
        || !codes[0] || codes[0].length > 4096) return completion(config.origin, false);
      const identity = await exchangeGoogleCode(codes[0], state.verifier, state.nonce, env, config.origin, fetcher);
      return completion(config.origin, true, await createAccountSession(identity, env));
    } catch (error) {
      console.error("Google sign-in callback failed", error?.name);
      return completion(config.origin, false);
    }
  }
  if (url.pathname === "/api/auth/logout") {
    if (request.method !== "POST") throw new HttpError(405, "This sign-in operation is not supported.");
    checkOrigin(request, config.origin);
    return json({ user: null }, 200, { "Set-Cookie": await endAccountSession(request, env) });
  }
  throw new HttpError(404, "This sign-in route does not exist.");
}
