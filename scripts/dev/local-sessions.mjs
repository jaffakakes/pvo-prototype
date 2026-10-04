import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const COOKIE = "restyle-local-render";
const LIFETIME_SECONDS = 180 * 24 * 60 * 60;
const TOKEN = /^([a-f0-9]{64})\.([0-9]{10})\.([a-f0-9]{64})$/;
export const localBetaDataDirectory = fileURLToPath(new URL("../../.wrangler/local-beta/", import.meta.url));

async function sessionSecret(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, "session-secret");
  try {
    await writeFile(path, randomBytes(32).toString("hex"), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  const value = (await readFile(path, "utf8")).trim();
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("The local beta session secret is invalid.");
  return Buffer.from(value, "hex");
}

function cookieValue(request) {
  const header = request.headers.cookie ?? "";
  const pair = header.split(";").map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`));
  return pair?.slice(COOKIE.length + 1) ?? null;
}

/** Persistent, signed local owner identity shared by rendering and reply boxes. */
export async function createLocalSessions({ directory = localBetaDataDirectory } = {}) {
  const secret = await sessionSecret(directory);
  const sign = value => createHmac("sha256", secret).update(value).digest("hex");
  const ownerFor = id => sign(`owner:${id}`);

  function from(request) {
    const token = cookieValue(request);
    const match = TOKEN.exec(token ?? "");
    if (!match) return null;
    const created = Number(match[2]);
    const now = Math.floor(Date.now() / 1000);
    if (created > now + 60 || now - created > LIFETIME_SECONDS) return null;
    const expected = Buffer.from(sign(`session:${match[1]}:${match[2]}`), "hex");
    const supplied = Buffer.from(match[3], "hex");
    if (!timingSafeEqual(expected, supplied)) return null;
    return { owner: ownerFor(match[1]), token };
  }

  function ensure(request) {
    const existing = from(request);
    if (existing) return existing;
    const id = randomBytes(32).toString("hex");
    const created = String(Math.floor(Date.now() / 1000));
    return { owner: ownerFor(id), token: `${id}.${created}.${sign(`session:${id}:${created}`)}` };
  }

  function cookie(token) {
    return `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${LIFETIME_SECONDS}`;
  }

  return { from, ensure, cookie };
}
