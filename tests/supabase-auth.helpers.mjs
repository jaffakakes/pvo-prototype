import { createLocalJWKSet, decodeJwt, exportJWK, generateKeyPair, SignJWT } from "jose";

export const PROJECT_URL = "https://restyle-test.supabase.co";
export const ISSUER = `${PROJECT_URL}/auth/v1`;
export const PUBLISHABLE_KEY = "sb_publishable_restyle_test";
export const SUBJECT = "11111111-1111-4111-8111-111111111111";
export const SESSION = "22222222-2222-4222-8222-222222222222";

export async function fixtureKeys(algorithm = "ES256") {
  const pair = await generateKeyPair(algorithm);
  const jwk = { ...(await exportJWK(pair.publicKey)), alg: algorithm, kid: "supabase-test" };
  return { pair, jwk, keys: createLocalJWKSet({ keys: [jwk] }) };
}

export async function token(pair, changes = {}, algorithm = "ES256") {
  const { issuer = ISSUER, sub = SUBJECT, sid = SESSION, audience = "authenticated",
    role = "authenticated", anonymous = false, name,
    issuedAt = Math.floor(Date.now() / 1000), expiresAt = issuedAt + 3600 } = changes;
  return new SignJWT({ sub, session_id: sid, role, is_anonymous: anonymous, user_metadata: { full_name: name } })
    .setProtectedHeader({ alg: algorithm, kid: "supabase-test" })
    .setIssuer(issuer).setAudience(audience).setIssuedAt(issuedAt).setNotBefore(issuedAt - 1)
    .setExpirationTime(expiresAt).sign(pair.privateKey);
}

export function authService(jwk, userChanges = {}) {
  return async (input, options) => {
    const request = typeof input?.url === "string" ? input : new Request(input, options);
    if (request.url === `${ISSUER}/.well-known/jwks.json`) return Response.json({ keys: [jwk] });
    if (request.url !== `${ISSUER}/user`) throw new Error(`Unexpected Auth URL ${request.url}`);
    const claims = decodeJwt(request.headers.get("Authorization").slice(7));
    return Response.json({ id: claims.sub, email: "creator@example.test", email_confirmed_at: "2026-01-01T00:00:00Z",
      is_anonymous: false, user_metadata: claims.user_metadata, ...userChanges });
  };
}
