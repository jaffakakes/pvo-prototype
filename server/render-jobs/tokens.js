import { HttpError } from "../http.js";

const encoder = new TextEncoder();

async function key(secret) {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function base64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function decode(value) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) return null;
  try {
    return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/") + "="), char => char.charCodeAt(0));
  } catch { return null; }
}

function signedBytes(method, jobId, target, objectKey, expires) {
  return encoder.encode(`${method}\n${jobId}\n${target}\n${objectKey}\n${expires}`);
}

export async function internalUrl(origin, secret, method, jobId, target, objectKey, expires) {
  const path = target === "result" || target === "progress"
    ? `/api/renders/internal/${jobId}/${target}`
    : `/api/renders/internal/${jobId}/sources/${target}`;
  const url = new URL(path, origin);
  url.searchParams.set("expires", String(expires));
  url.searchParams.set("token", base64url(await crypto.subtle.sign("HMAC", await key(secret),
    signedBytes(method, jobId, target, objectKey, expires))));
  return url.href;
}

export async function verifyInternalUrl(url, secret, method, jobId, target, objectKey) {
  const expires = Number(url.searchParams.get("expires"));
  const signature = decode(url.searchParams.get("token") || "");
  if (!Number.isSafeInteger(expires) || expires < Date.now() || expires > Date.now() + 20 * 60 * 1000 || !signature)
    throw new HttpError(403, "This render transfer has expired.");
  const valid = await crypto.subtle.verify("HMAC", await key(secret), signature,
    signedBytes(method, jobId, target, objectKey, expires));
  if (!valid) throw new HttpError(403, "This render transfer is unavailable.");
}
