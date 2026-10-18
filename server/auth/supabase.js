import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";
import { HttpError } from "../http.js";

const INVALID_TOKEN = "Email sign-in could not be verified. Please try again.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cachedKeys = new Map();

export function supabaseProjectUrl(value) {
  return typeof value === "string" &&
    /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(value)
    ? value
    : null;
}

export function supabasePublicKey(value) {
  return typeof value === "string" &&
    /^sb_publishable_[A-Za-z0-9_-]+$/.test(value)
    ? value
    : null;
}

function keysForIssuer(issuer, fetcher) {
  const create = () =>
    createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`), {
      timeoutDuration: 10000,
      [customFetch]: (url, options) =>
        fetcher(url, { ...options, redirect: "manual" }),
    });
  if (fetcher !== fetch) return create();
  if (!cachedKeys.has(issuer)) cachedKeys.set(issuer, create());
  return cachedKeys.get(issuer);
}

export async function verifySupabaseIdentity(token, keys, issuer) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_.-]{1,16384}$/.test(token))
    throw new HttpError(401, INVALID_TOKEN);
  try {
    const { payload } = await jwtVerify(token, keys, {
      algorithms: ["ES256", "RS256"],
      issuer,
      audience: "authenticated",
      clockTolerance: 10,
      requiredClaims: ["exp", "iat", "sub"],
    });
    if (
      !UUID.test(payload.sub) ||
      !UUID.test(payload.session_id || "") ||
      payload.role !== "authenticated" ||
      payload.is_anonymous !== false
    )
      throw new Error("Invalid session claims");
    return { issuer, sub: payload.sub, sid: payload.session_id };
  } catch {
    throw new HttpError(401, INVALID_TOKEN);
  }
}

/** Verify the project signature and retrieve the current, confirmed email from Auth. */
export async function supabaseIdentityFromRequest(
  request,
  projectUrl,
  publishableKey,
  fetcher = fetch,
) {
  const token = /^Bearer ([A-Za-z0-9_.-]{1,16384})$/.exec(
    request.headers.get("Authorization") || "",
  )?.[1];
  const issuer = `${projectUrl}/auth/v1`;
  const identity = await verifySupabaseIdentity(
    token,
    keysForIssuer(issuer, fetcher),
    issuer,
  );
  try {
    const response = await fetcher(`${issuer}/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: publishableKey },
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error("Invalid Auth session");
    const user = await response.json();
    if (
      user.id !== identity.sub ||
      user.is_anonymous !== false ||
      !user.email_confirmed_at ||
      typeof user.email !== "string" ||
      !user.email.trim()
    )
      throw new Error("Unconfirmed email");
    const name = user.user_metadata?.full_name;
    return {
      ...identity,
      name:
        typeof name === "string" && name.trim()
          ? name.trim().slice(0, 120)
          : "Creator",
    };
  } catch {
    throw new HttpError(401, INVALID_TOKEN);
  }
}
