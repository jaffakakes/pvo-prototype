import { cookieValue, signCookie, verifyCookie, setCookie } from "./sessionCookies.js";
import { digest, randomId } from "../identity.js";

const SESSION_COOKIE = "__Host-restyle-publishing";
const SESSION_SECONDS = 180 * 24 * 60 * 60;

export async function getSession(request, env) {
  const signed = await verifyCookie(cookieValue(request, SESSION_COOKIE), env.SESSION_SECRET);
  if (typeof signed?.token !== "string") return null;
  return env.DB.prepare(`SELECT creators.id FROM sessions
    JOIN creators ON creators.id = sessions.owner_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?`)
    .bind(await digest(signed.token), Date.now()).first();
}

export async function createSession(env) {
  const ownerId = randomId();
  const token = randomId(32);
  const now = Date.now();
  const cookie = setCookie(SESSION_COOKIE,
    await signCookie({ token }, env.SESSION_SECRET, SESSION_SECONDS), SESSION_SECONDS);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO creators (id, created_at) VALUES (?, ?)").bind(ownerId, now),
    env.DB.prepare("INSERT INTO sessions (token_hash, owner_id, expires_at) VALUES (?, ?, ?)")
      .bind(await digest(token), ownerId, now + SESSION_SECONDS * 1000),
  ]);
  return cookie;
}
