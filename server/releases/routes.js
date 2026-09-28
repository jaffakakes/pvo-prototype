import { checkOrigin, HttpError, json, notFound, readJson } from "../http.js";

async function authorized(request, secret) {
  if (!secret) return false;
  const supplied = request.headers.get("Authorization") || "";
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`Bearer ${secret}`));
  return crypto.subtle.verify("HMAC", key, signature, encoder.encode(supplied));
}

export async function releaseRoute(request, env) {
  if (!env.RELEASES) throw new HttpError(503, "Release notifications are unavailable.");
  const url = new URL(request.url);
  if (url.pathname === "/api/releases/connect") {
    if (request.method !== "GET") throw new HttpError(405, "Use GET.");
    checkOrigin(request, url.origin);
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
      throw new HttpError(426, "A WebSocket connection is required.");
    return env.RELEASES.getByName("beta").fetch(request);
  }
  if (url.pathname !== "/api/releases/announce") return notFound();
  if (request.method !== "POST") throw new HttpError(405, "Use POST.");
  if (!await authorized(request, env.RELEASE_NOTIFY_TOKEN)) throw new HttpError(401, "Release authorization required.");
  const input = await readJson(request, 256);
  if (!/^restyle-editor-shell-[a-f0-9]{16}$/.test(input?.revision))
    throw new HttpError(400, "Invalid release revision.");
  // Announce only the release whose assets have actually been deployed.
  const response = await env.ASSETS.fetch(new Request(new URL("/editor/release.json", url)));
  if (!response.ok || (await response.json()).revision !== input.revision)
    throw new HttpError(409, "The release assets are not ready.");
  await env.RELEASES.getByName("beta").announce(input.revision);
  return json({ revision: input.revision });
}
