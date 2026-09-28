import { cookieValue, signCookie, verifyCookie, setCookie } from "./tokens.js";
import { digest, randomId } from "../identity.js";

const SESSION_COOKIE = "__Host-restyle-session";
const SESSION_SECONDS = 7 * 24 * 60 * 60;

export async function getSession(request, env) {
  const signed = await verifyCookie(cookieValue(request, SESSION_COOKIE), env.SESSION_SECRET, "session");
  if (typeof signed?.token !== "string") return null;
  return env.DB.prepare(`SELECT creators.id, creators.display_name AS name FROM sessions
    JOIN creators ON creators.id = sessions.owner_id WHERE sessions.token_hash = ? AND sessions.expires_at > ?`)
    .bind(await digest(signed.token), Date.now()).first();
}

export async function createSession(identity, env) {
  await env.DB.prepare(`INSERT INTO creators (id, google_subject, display_name, created_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(google_subject) DO UPDATE SET display_name = excluded.display_name`)
    .bind(randomId(), identity.sub, identity.name, Date.now()).run();
  const owner = await env.DB.prepare("SELECT id FROM creators WHERE google_subject = ?").bind(identity.sub).first();
  const token = randomId(32);
  await env.DB.prepare("INSERT INTO sessions (token_hash, owner_id, expires_at) VALUES (?, ?, ?)")
    .bind(await digest(token), owner.id, Date.now() + SESSION_SECONDS * 1000).run();
  return setCookie(SESSION_COOKIE, await signCookie({ token }, env.SESSION_SECRET, "session", SESSION_SECONDS), SESSION_SECONDS);
}

export async function endSession(request, env) {
  const signed = await verifyCookie(cookieValue(request, SESSION_COOKIE), env.SESSION_SECRET, "session");
  if (typeof signed?.token === "string")
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await digest(signed.token)).run();
  return setCookie(SESSION_COOKIE, "", 0);
}
