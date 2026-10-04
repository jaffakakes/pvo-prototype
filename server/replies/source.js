/** Bind a short-lived abuse key to one box without retaining a viewer's address. */
export async function replySourceHash(request, secret, boxId, now = Date.now()) {
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip || ip.length > 45 || !/^[0-9a-fA-F:.]+$/.test(ip)) return null;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const day = Math.floor(now / 86400000);
  const bytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${boxId}:${day}:${ip}`));
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
