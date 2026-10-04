import { cookieValue, signCookie, verifyCookie, setCookie } from "./tokens.js";
import { digest, randomId } from "../identity.js";

const SESSION_COOKIE = "__Host-pvo-session";
const SESSION_SECONDS = 7 * 24 * 60 * 60;

export async function getAccountSession(request, env) {
  if (!env.DB || !env.SESSION_SECRET) return null;
  const signed = await verifyCookie(cookieValue(request, SESSION_COOKIE), env.SESSION_SECRET, "session");
  if (typeof signed?.token !== "string") return null;
  const account = await env.DB.prepare(`SELECT users.id, users.display_name AS name FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?`)
    .bind(await digest(signed.token), Date.now()).first();
  return account || null;
}

async function userForGoogle(identity, db) {
  const existing = await db.prepare(`SELECT users.id FROM provider_identities
    JOIN users ON users.id = provider_identities.user_id
    WHERE provider = 'google' AND subject = ?`).bind(identity.sub).first();
  if (existing) {
    await db.prepare("UPDATE users SET display_name = ? WHERE id = ?").bind(identity.name, existing.id).run();
    return existing.id;
  }
  const id = randomId();
  try {
    await db.batch([
      db.prepare("INSERT INTO users (id, display_name, created_at) VALUES (?, ?, ?)")
        .bind(id, identity.name, Date.now()),
      db.prepare("INSERT INTO provider_identities (provider, subject, user_id) VALUES ('google', ?, ?)")
        .bind(identity.sub, id),
    ]);
    return id;
  } catch (error) {
    // A concurrent callback may have created the same provider identity first.
    const winner = await db.prepare("SELECT user_id AS id FROM provider_identities WHERE provider = 'google' AND subject = ?")
      .bind(identity.sub).first();
    if (!winner) throw error;
    return winner.id;
  }
}

export async function createAccountSession(identity, env) {
  const userId = await userForGoogle(identity, env.DB);
  const token = randomId(32);
  const now = Date.now();
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(await digest(token), userId, now + SESSION_SECONDS * 1000).run();
  const signed = await signCookie({ token }, env.SESSION_SECRET, "session", SESSION_SECONDS);
  return setCookie(SESSION_COOKIE, signed, SESSION_SECONDS);
}

export async function endAccountSession(request, env) {
  const signed = await verifyCookie(cookieValue(request, SESSION_COOKIE), env.SESSION_SECRET, "session");
  if (typeof signed?.token === "string" && env.DB)
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await digest(signed.token)).run();
  return setCookie(SESSION_COOKIE, "", 0);
}

export async function cleanupAccountSessions(env, now = Date.now()) {
  if (!env.DB) return;
  await env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now).run();
}
