import { createHash, createHmac, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { signCookie, verifyCookie } from "../../server/auth/tokens.js";

const SESSION_COOKIE = "pvo-local-session";
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const OAUTH_COOKIE = "pvo-local-oauth";
const OAUTH_SECONDS = 10 * 60;

function cookieValue(request, name) {
  const pair = (request.headers.cookie ?? "").split(";").map(part => part.trim())
    .find(part => part.startsWith(`${name}=`));
  return pair?.slice(name.length + 1) ?? "";
}

function cookie(name, value, seconds) {
  // The beta binds only to HTTP loopback, where a Secure cookie cannot be relied upon.
  return `${name}=${value}; Path=/; Max-Age=${seconds}; HttpOnly; SameSite=Lax`;
}

function tokenHash(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function loadSecret(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const path = join(directory, "auth-secret");
  try {
    await writeFile(path, randomBytes(32).toString("hex"), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  await chmod(path, 0o600);
  const secret = (await readFile(path, "utf8")).trim();
  if (!/^[a-f0-9]{64}$/.test(secret)) throw new Error("The local beta auth secret is invalid.");
  return secret;
}

function validData(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && value.users && typeof value.users === "object" && !Array.isArray(value.users)
    && value.sessions && typeof value.sessions === "object" && !Array.isArray(value.sessions);
}

/** Private account and revocable-session records for the single-process loopback beta. */
export async function createLocalAuthStore(directory) {
  const secret = await loadSecret(directory);
  const path = join(directory, "auth-accounts.json");
  let data;
  try {
    data = JSON.parse(await readFile(path, "utf8"));
    if (!validData(data)) throw new Error("The local beta account data is invalid.");
    await chmod(path, 0o600);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    data = { users: {}, sessions: {} };
  }
  let writes = Promise.resolve();

  async function persist() {
    const temporary = join(directory, `auth-accounts.${randomBytes(8).toString("hex")}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(data), { flag: "wx", mode: 0o600 });
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  function mutate(change) {
    const next = writes.then(async () => {
      const result = await change();
      await persist();
      return result;
    });
    writes = next.then(() => undefined, () => undefined);
    return next;
  }

  function userIdForGoogle(sub) {
    return createHmac("sha256", Buffer.from(secret, "hex")).update(`google:${sub}`).digest("base64url");
  }

  async function userFor(request) {
    const signed = await verifyCookie(cookieValue(request, SESSION_COOKIE), secret, "local-session");
    if (typeof signed?.token !== "string") return null;
    const record = data.sessions[tokenHash(signed.token)];
    if (!record || record.expiresAt <= Date.now()) return null;
    const user = data.users[record.userId];
    return user ? { id: record.userId, name: user.name } : null;
  }

  async function startSession(identity) {
    return mutate(async () => {
      const id = userIdForGoogle(identity.sub);
      data.users[id] = { name: identity.name };
      for (const [hash, session] of Object.entries(data.sessions)) {
        if (session.expiresAt <= Date.now()) delete data.sessions[hash];
      }
      const token = randomBytes(32).toString("base64url");
      data.sessions[tokenHash(token)] = { userId: id, expiresAt: Date.now() + SESSION_SECONDS * 1000 };
      return cookie(SESSION_COOKIE, await signCookie({ token }, secret, "local-session", SESSION_SECONDS), SESSION_SECONDS);
    });
  }

  async function endSession(request) {
    const signed = await verifyCookie(cookieValue(request, SESSION_COOKIE), secret, "local-session");
    if (typeof signed?.token === "string") {
      await mutate(() => { delete data.sessions[tokenHash(signed.token)]; });
    }
    return cookie(SESSION_COOKIE, "", 0);
  }

  return {
    userFor, startSession, endSession,
    oauthCookie: (value, seconds = OAUTH_SECONDS) => cookie(OAUTH_COOKIE, value, seconds),
    signOAuth: value => signCookie(value, secret, "local-oauth", OAUTH_SECONDS),
    verifyOAuth: request => verifyCookie(cookieValue(request, OAUTH_COOKIE), secret, "local-oauth"),
  };
}
