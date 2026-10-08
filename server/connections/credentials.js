import { HttpError } from "../http.js";

export function connectionSetupAvailable(env) {
  return /^[a-f0-9]{64}$/.test(env.ACCOUNT_CONNECTION_KEY ?? "");
}

async function key(env) {
  if (!connectionSetupAvailable(env))
    throw new HttpError(
      503,
      "Private account setup is unavailable. Try again later.",
    );
  const bytes = Uint8Array.from(
    env.ACCOUNT_CONNECTION_KEY.match(/../g),
    (value) => parseInt(value, 16),
  );
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}
const encode = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const decode = (value) =>
  Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
const context = (ownerId, id, revision) =>
  new TextEncoder().encode(JSON.stringify([ownerId, id, revision]));

/** Ciphertext stays in the owner object; the wrapping key is a separate Worker secret. */
export async function protectCredential(env, ownerId, id, revision, token) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: context(ownerId, id, revision) },
    await key(env),
    new TextEncoder().encode(token),
  );
  return JSON.stringify({ iv: encode(iv), body: encode(body) });
}
export async function openCredential(env, ownerId, id, revision, envelope) {
  try {
    const value = JSON.parse(envelope);
    const body = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: decode(value.iv),
        additionalData: context(ownerId, id, revision),
      },
      await key(env),
      decode(value.body),
    );
    return new TextDecoder().decode(body);
  } catch {
    throw new HttpError(
      503,
      "This connection could not be unlocked. Reconnect it or contact the server operator.",
    );
  }
}
