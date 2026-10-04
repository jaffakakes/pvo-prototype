import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { exchangeGoogleCode } from "../../server/auth/google.js";
import { randomId, digest } from "../../server/identity.js";
import { escapeHtml } from "../../server/http.js";
import { createLocalAuthStore } from "./local-auth-store.mjs";

const STATE_SECONDS = 10 * 60;

function json(response, status, value, headers = {}) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  response.end(JSON.stringify(value));
}

function error(response, status, message) {
  json(response, status, { error: message });
}

function validCredential(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 1024 && !/\s/.test(value);
}

async function loadClient(directory, clientId, clientSecret) {
  if (clientId !== undefined || clientSecret !== undefined) {
    if (!validCredential(clientId) || !validCredential(clientSecret))
      throw new Error("Set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET for local Google sign-in.");
    return { clientId, clientSecret };
  }
  const path = join(directory, "google-client.json");
  let source;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  const details = await stat(path);
  if (!details.isFile() || (details.mode & 0o077))
    throw new Error("The local Google client file must be a private mode-0600 file.");
  let client;
  try { client = JSON.parse(source); }
  catch { throw new Error("The local Google client file is not valid JSON."); }
  if (!client || typeof client !== "object" || Array.isArray(client)
    || !validCredential(client.clientId) || !validCredential(client.clientSecret))
    throw new Error("The local Google client file needs clientId and clientSecret strings.");
  return client;
}

function complete(response, origin, store, ok, sessionCookie) {
  const nonce = randomId();
  const scriptOrigin = JSON.stringify(origin).replaceAll("<", "\\u003c");
  const html = `<!doctype html><meta charset="utf-8"><title>PVO sign-in</title>
    <p>${ok ? "Signed in. You can return to your video." : "Sign-in could not finish. Return to your video and try again."}</p>
    <a href="${escapeHtml(origin)}/editor/">Return to PVO</a>
    <script nonce="${nonce}">if(window.opener){window.opener.postMessage({type:"pvo:auth:complete",ok:${ok}},${scriptOrigin});window.close();}</script>`;
  response.writeHead(ok ? 200 : 400, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'`,
    "Referrer-Policy": "no-referrer",
    "Set-Cookie": [store.oauthCookie("", 0), ...(sessionCookie ? [sessionCookie] : [])],
  });
  response.end(html);
}

/** Google account routes for the HTTP loopback beta; no D1 or Worker bindings. */
export async function createLocalAuthApi({ directory, origin, clientId, clientSecret, fetcher = fetch }) {
  const base = new URL(origin);
  if (base.origin !== origin || base.protocol !== "http:" || base.hostname !== "127.0.0.1")
    throw new Error("Local Google sign-in requires a canonical http://127.0.0.1 origin.");
  const client = await loadClient(directory, clientId, clientSecret);
  const store = await createLocalAuthStore(directory);
  const available = Boolean(client);

  async function userFor(request) {
    return available ? store.userFor(request) : null;
  }

  async function handle(request, response, pathname) {
    if (!pathname.startsWith("/api/auth/")) return false;
    if (request.headers.host !== base.host || new URL(request.url, origin).origin !== origin)
      return error(response, 400, "This sign-in address is invalid.");
    if (pathname === "/api/auth/session") {
      if (request.method !== "GET") return error(response, 405, "This sign-in operation is not supported.");
      return json(response, 200, { available, user: await userFor(request) });
    }
    if (pathname === "/api/auth/google/start") {
      if (request.method !== "GET") return error(response, 405, "This sign-in operation is not supported.");
      if (!available) return error(response, 503, "Google sign-in is not configured here yet.");
      const state = randomId(32);
      const nonce = randomId(32);
      const verifier = randomId(32);
      const signedState = await store.signOAuth({ state, nonce, verifier });
      const destination = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      destination.search = new URLSearchParams({ client_id: client.clientId, response_type: "code",
        scope: "openid profile", redirect_uri: `${origin}/api/auth/google/callback`, state, nonce,
        code_challenge: await digest(verifier), code_challenge_method: "S256", prompt: "select_account" }).toString();
      response.writeHead(302, { Location: destination.href, "Cache-Control": "no-store",
        "Set-Cookie": store.oauthCookie(signedState, STATE_SECONDS), "Referrer-Policy": "no-referrer" });
      return response.end();
    }
    if (pathname === "/api/auth/google/callback") {
      if (request.method !== "GET") return error(response, 405, "This sign-in operation is not supported.");
      if (!available) return error(response, 503, "Google sign-in is not configured here yet.");
      try {
        const url = new URL(request.url, origin);
        const state = await store.verifyOAuth(request);
        const codes = url.searchParams.getAll("code");
        const states = url.searchParams.getAll("state");
        if (!state || states.length !== 1 || states[0] !== state.state || codes.length !== 1
          || !codes[0] || codes[0].length > 4096) return complete(response, origin, store, false);
        const identity = await exchangeGoogleCode(codes[0], state.verifier, state.nonce,
          { GOOGLE_CLIENT_ID: client.clientId, GOOGLE_CLIENT_SECRET: client.clientSecret }, origin, fetcher);
        return complete(response, origin, store, true, await store.startSession(identity));
      } catch (cause) {
        console.error("Local Google sign-in callback failed:", cause?.name);
        return complete(response, origin, store, false);
      }
    }
    if (pathname === "/api/auth/logout") {
      if (request.method !== "POST") return error(response, 405, "This sign-in operation is not supported.");
      if (request.headers.origin !== origin
        || (request.headers["sec-fetch-site"] && !["same-origin", "none"].includes(request.headers["sec-fetch-site"])))
        return error(response, 403, "This operation must start from the editor.");
      return json(response, 200, { user: null }, { "Set-Cookie": await store.endSession(request) });
    }
    return error(response, 404, "This sign-in route does not exist.");
  }

  return { handle, userFor };
}
