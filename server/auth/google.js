import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";
import { HttpError } from "../http.js";

export async function verifyGoogleIdentity(token, keys, clientId, nonce) {
  if (typeof token !== "string" || token.length > 16384)
    throw new HttpError(401, "Google sign-in could not be verified.");
  const { payload } = await jwtVerify(token, keys, {
    algorithms: ["RS256"], issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: clientId, maxTokenAge: "10m", clockTolerance: 30,
  });
  if (payload.nonce !== nonce || (payload.azp && payload.azp !== clientId)
    || typeof payload.sub !== "string" || !payload.sub || payload.sub.length > 255)
    throw new HttpError(401, "Google sign-in could not be verified.");
  const name = typeof payload.name === "string" ? payload.name.trim().slice(0, 120) : "";
  return { sub: payload.sub, name: name || "Creator" };
}

export async function exchangeGoogleCode(code, verifier, nonce, env, origin, fetcher = fetch) {
  // Workers reject redirect: "error"; manual lets us reject redirects without following them.
  const response = await fetcher("https://oauth2.googleapis.com/token", {
    method: "POST", redirect: "manual", signal: AbortSignal.timeout(15000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
      code, code_verifier: verifier, grant_type: "authorization_code",
      redirect_uri: `${origin}/api/auth/google/callback` }),
  });
  if (!response.ok) throw new HttpError(401, "Google sign-in did not complete. Please try again.");
  const tokens = await response.json();
  const keys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"), { [customFetch]: fetcher });
  return verifyGoogleIdentity(tokens.id_token, keys, env.GOOGLE_CLIENT_ID, nonce);
}
