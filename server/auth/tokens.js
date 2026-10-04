import { SignJWT, jwtVerify } from "jose";

const ISSUER = "pvo-auth";

export async function signCookie(payload, secret, audience, seconds) {
  return new SignJWT(payload).setProtectedHeader({ alg: "HS256" }).setIssuer(ISSUER)
    .setAudience(audience).setIssuedAt().setExpirationTime(`${seconds}s`)
    .sign(new TextEncoder().encode(secret));
}

export async function verifyCookie(value, secret, audience) {
  if (!value || value.length > 4096 || !secret) return null;
  try {
    return (await jwtVerify(value, new TextEncoder().encode(secret), {
      algorithms: ["HS256"], issuer: ISSUER, audience,
    })).payload;
  } catch { return null; }
}

export function cookieValue(request, name) {
  return request.headers.get("Cookie")?.split(";").map(part => part.trim())
    .find(part => part.startsWith(`${name}=`))?.slice(name.length + 1) || "";
}

export function setCookie(name, value, seconds) {
  return `${name}=${value}; Path=/; Max-Age=${seconds}; HttpOnly; Secure; SameSite=Lax`;
}
