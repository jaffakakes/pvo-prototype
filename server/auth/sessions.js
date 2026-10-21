import { cookieValue, signCookie, verifyCookie, setCookie } from "./tokens.js";
import { digest, randomId } from "../identity.js";
import { accountForSupabase } from "./supabaseAccounts.js";

const SESSION_COOKIE = "__Host-pvo-session";
const SESSION_SECONDS = 15 * 60;

export async function getAccountSession(request, env) {
  if (!env.DB || !env.SESSION_SECRET) return null;
  const signed = await verifyCookie(
    cookieValue(request, SESSION_COOKIE),
    env.SESSION_SECRET,
    "session",
  );
  if (typeof signed?.token !== "string") return null;
  const account = await env.DB.prepare(
    `SELECT users.id, users.display_name AS name FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?`,
  )
    .bind(await digest(signed.token), Date.now())
    .first();
  return account || null;
}

export async function createAccountSession(identity, env) {
  const user = await accountForSupabase(identity, env.DB);
  const token = randomId(32);
  await env.DB.prepare(
    "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
  )
    .bind(await digest(token), user.id, Date.now() + SESSION_SECONDS * 1000)
    .run();
  const signed = await signCookie(
    { token },
    env.SESSION_SECRET,
    "session",
    SESSION_SECONDS,
  );
  return { user, cookie: setCookie(SESSION_COOKIE, signed, SESSION_SECONDS) };
}

export async function endAccountSession(request, env) {
  const signed = await verifyCookie(
    cookieValue(request, SESSION_COOKIE),
    env.SESSION_SECRET,
    "session",
  );
  if (typeof signed?.token === "string" && env.DB)
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?")
      .bind(await digest(signed.token))
      .run();
  return setCookie(SESSION_COOKIE, "", 0);
}

export async function cleanupAccountSessions(env, now = Date.now()) {
  if (!env.DB) return;
  await env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?")
    .bind(now)
    .run();
}
