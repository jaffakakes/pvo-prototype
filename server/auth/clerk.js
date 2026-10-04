import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";
import { HttpError } from "../http.js";

const TOKEN_LIMIT = 16384;
const INVALID_TOKEN = "Email sign-in could not be verified. Please try again.";
const cachedKeys = new Map();

function bearerToken(request) {
  const authorization = request.headers.get("Authorization") || "";
  const match = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(authorization);
  if (!match || match[1].length > TOKEN_LIMIT) throw new HttpError(401, INVALID_TOKEN);
  return match[1];
}

function keysForIssuer(issuer, fetcher) {
  if (fetcher !== fetch) return createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`),
    { [customFetch]: fetcher });
  let keys = cachedKeys.get(issuer);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
    cachedKeys.set(issuer, keys);
  }
  return keys;
}

export async function verifyClerkIdentity(token, keys, issuer, authorizedParty) {
  if (typeof token !== "string" || !token || token.length > TOKEN_LIMIT) throw new HttpError(401, INVALID_TOKEN);
  try {
    const { payload } = await jwtVerify(token, keys, {
      algorithms: ["RS256"], issuer, maxTokenAge: "2m", clockTolerance: 10,
    });
    if (payload.azp !== authorizedParty || payload.sts !== "active"
      || typeof payload.sub !== "string" || !/^user_[A-Za-z0-9]+$/.test(payload.sub)
      || typeof payload.sid !== "string" || !/^sess_[A-Za-z0-9]+$/.test(payload.sid))
      throw new HttpError(401, INVALID_TOKEN);
    const name = typeof payload.name === "string" ? payload.name.trim().slice(0, 120) : "";
    return { issuer, sub: payload.sub, sid: payload.sid, name: name || "Creator" };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(401, INVALID_TOKEN);
  }
}

export async function clerkIdentityFromRequest(request, issuer, authorizedParty, fetcher = fetch) {
  return verifyClerkIdentity(bearerToken(request), keysForIssuer(issuer, fetcher), issuer, authorizedParty);
}
