import { json, checkOrigin, HttpError, escapeHtml } from "../http.js";
import { randomId, digest } from "../identity.js";
import { cookieValue, signCookie, verifyCookie, setCookie } from "./tokens.js";
import { createSession, endSession } from "./sessions.js";
import { exchangeGoogleCode } from "./google.js";

const STATE_COOKIE = "__Host-restyle-oauth";

function completion(origin, ok, sessionCookie) {
  const nonce = randomId();
  const scriptOrigin = JSON.stringify(origin).replaceAll("<", "\\u003c");
  const html = `<!doctype html><meta charset="utf-8"><title>Restyle sign-in</title>
    <p>${ok ? "Signed in. You can return to your video." : "Sign-in could not finish. Return to your video and try again."}</p>
    <a href="${escapeHtml(origin)}/editor/">Return to Restyle</a>
    <script nonce="${nonce}">if(window.opener){window.opener.postMessage({type:"restyle-auth",ok:${ok}},${scriptOrigin});window.close();}</script>`;
  const headers = new Headers({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
    "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`,
    "Referrer-Policy": "no-referrer" });
  headers.append("Set-Cookie", setCookie(STATE_COOKIE, "", 0));
  if (sessionCookie) headers.append("Set-Cookie", sessionCookie);
  return new Response(html, { status: ok ? 200 : 400, headers });
}

export async function authRoute(request, env, config, fetcher = fetch) {
  const url = new URL(request.url);
  if (!config.available) throw new HttpError(503, "Online sharing is not configured yet.");
  if (url.pathname === "/api/auth/login" && request.method === "GET") {
    const state = randomId(32);
    const nonce = randomId(32);
    const verifier = randomId(32);
    const cookie = await signCookie({ state, nonce, verifier }, env.SESSION_SECRET, "oauth", 600);
    const destination = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    destination.search = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, response_type: "code",
      scope: "openid profile", redirect_uri: `${config.origin}/api/auth/callback`, state, nonce,
      code_challenge: await digest(verifier), code_challenge_method: "S256", prompt: "select_account" }).toString();
    return new Response(null, { status: 302, headers: { Location: destination.href, "Cache-Control": "no-store",
      "Set-Cookie": setCookie(STATE_COOKIE, cookie, 600), "Referrer-Policy": "no-referrer" } });
  }
  if (url.pathname === "/api/auth/callback" && request.method === "GET") {
    try {
      const state = await verifyCookie(cookieValue(request, STATE_COOKIE), env.SESSION_SECRET, "oauth");
      const code = url.searchParams.get("code");
      if (!state || state.state !== url.searchParams.get("state") || !code || code.length > 4096)
        return completion(config.origin, false);
      const identity = await exchangeGoogleCode(code, state.verifier, state.nonce, env, config.origin, fetcher);
      return completion(config.origin, true, await createSession(identity, env));
    } catch {
      return completion(config.origin, false);
    }
  }
  if (url.pathname === "/api/auth/logout" && request.method === "POST") {
    checkOrigin(request, config.origin);
    return json({ ok: true }, 200, { "Set-Cookie": await endSession(request, env) });
  }
  throw new HttpError(404, "This sign-in route does not exist.");
}
