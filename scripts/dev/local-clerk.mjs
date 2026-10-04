import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";

function validPublishableKey(value) {
  return typeof value === "string" && /^pk_test_[A-Za-z0-9_-]+$/.test(value);
}

function validIssuer(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === value && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** Load only public Clerk instance metadata from the private local beta configuration. */
export async function loadLocalClerk(directory, publishableKey, issuer, fetcher = fetch) {
  let settings;
  if (publishableKey !== undefined || issuer !== undefined) {
    settings = { publishableKey, issuer };
  } else {
    const path = join(directory, "clerk.json");
    let source;
    try {
      source = await readFile(path, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
    const details = await stat(path);
    if (!details.isFile() || (details.mode & 0o077))
      throw new Error("The local Clerk configuration must be a private mode-0600 file.");
    try { settings = JSON.parse(source); }
    catch { throw new Error("The local Clerk configuration is not valid JSON."); }
  }
  if (!settings || !validPublishableKey(settings.publishableKey) || !validIssuer(settings.issuer))
    throw new Error("Local Clerk sign-in needs a development publishable key and HTTPS issuer.");
  const jwks = createRemoteJWKSet(new URL(`${settings.issuer}/.well-known/jwks.json`), {
    timeoutDuration: 10000,
    cacheMaxAge: 5 * 60 * 1000,
    [customFetch]: (url, options) => fetcher(url, { ...options, redirect: "manual" }),
  });
  return { publishableKey: settings.publishableKey, issuer: settings.issuer, jwks };
}

/** Only an active Clerk session minted for this loopback editor can establish a beta account. */
export async function verifyLocalClerkSession(token, clerk, origin) {
  if (typeof token !== "string" || token.length > 16384 || !/^[A-Za-z0-9._-]+$/.test(token))
    throw new Error("Invalid Clerk session token.");
  const { payload } = await jwtVerify(token, clerk.jwks, {
    algorithms: ["RS256"],
    issuer: clerk.issuer,
    maxTokenAge: "2m",
    clockTolerance: 30,
  });
  if (payload.azp !== origin || typeof payload.exp !== "number"
    || typeof payload.sub !== "string" || !/^user_[A-Za-z0-9]+$/.test(payload.sub)
    || typeof payload.sid !== "string" || !/^sess_[A-Za-z0-9]+$/.test(payload.sid)
    || (payload.sts !== undefined && payload.sts !== "active"))
    throw new Error("Invalid Clerk session claims.");
  return { issuer: clerk.issuer, sub: payload.sub, name: "Creator" };
}
