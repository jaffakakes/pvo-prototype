import { lstat, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const INVENTORY_PATH = "/editor/retained-assets.json";
const MAX_ASSETS = 512;
const MAX_ASSET_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_BYTES = 128 * 1024 * 1024;
const MAX_METADATA_BYTES = 256 * 1024;
const TYPES = {
  js: ["text/javascript", "application/javascript", "application/x-javascript"],
  css: ["text/css"], wasm: ["application/wasm"],
  woff2: ["font/woff2", "application/font-woff2"],
  woff: ["font/woff", "application/font-woff"],
  ttf: ["font/ttf", "application/x-font-ttf"], otf: ["font/otf", "application/x-font-opentype"],
  png: ["image/png"], jpg: ["image/jpeg"], jpeg: ["image/jpeg"],
  gif: ["image/gif"], webp: ["image/webp"], avif: ["image/avif"],
  svg: ["image/svg+xml"], ico: ["image/x-icon", "image/vnd.microsoft.icon"],
};
const ASSET_PATH = /^\/editor\/assets\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}-[A-Za-z0-9_-]{8,32}\.([a-z0-9]+)$/;

function assetExtension(path) {
  const extension = typeof path === "string" && ASSET_PATH.exec(path)?.[1];
  if (!extension || !Object.hasOwn(TYPES, extension)) throw new Error(`Invalid retained editor asset path: ${String(path).slice(0, 160)}`);
  return extension;
}

function inventoryPaths(text) {
  const data = JSON.parse(text);
  if (!data || typeof data !== "object" || Array.isArray(data)
      || Object.keys(data).length !== 1 || !Array.isArray(data.assets) || data.assets.length > MAX_ASSETS)
    throw new Error("Invalid retained editor asset inventory.");
  data.assets.forEach(assetExtension);
  return data.assets;
}

function precachePaths(text) {
  const match = text.match(/\bconst\s+PRECACHE_URLS\s*=\s*(\[[\s\S]*?\]);/);
  if (!match) throw new Error("Deployed service worker has no readable precache inventory.");
  const paths = JSON.parse(match[1]);
  if (!Array.isArray(paths) || paths.length > MAX_ASSETS + 20 || paths.some(path => typeof path !== "string"))
    throw new Error("Deployed service worker has an invalid precache inventory.");
  const assets = paths.filter(path => path.startsWith("./assets/")).map(path => `/editor/${path.slice(2)}`);
  if (!assets.length || !paths.includes("./index.html")) throw new Error("Deployed service worker has an incomplete precache inventory.");
  assets.forEach(assetExtension);
  return assets;
}

async function readBoundedBody(response, maxBytes) {
  const declared = response.headers.get("content-length");
  if (declared != null && (!/^\d+$/.test(declared) || Number(declared) > maxBytes))
    throw new Error("Asset response exceeds its size limit or has an invalid length.");
  if (!response.body) throw new Error("Asset response has no body.");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  let complete = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error("Asset response exceeds its size limit.");
      chunks.push(value);
    }
    if (!size || declared != null && !response.headers.get("content-encoding") && size !== Number(declared))
      throw new Error("Asset response is empty or incomplete.");
    complete = true;
    return Buffer.concat(chunks, size);
  } finally {
    if (!complete) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function ensurePlainDirectory(path) {
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Asset directory is not a plain directory: ${path}`);
}

/** Add immutable old files to a fresh release without changing its shell or precache. */
export async function retainEditorAssets({ distRoot, origin, fetch: fetchImpl = globalThis.fetch, timeoutMs = 60_000 }) {
  const base = new URL(origin);
  if (base.protocol !== "https:" || base.username || base.password || base.pathname !== "/" || base.search || base.hash)
    throw new Error("Asset retention requires an exact HTTPS deployment origin.");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000)
    throw new Error("Asset retention timeout must be between 1 and 60000 milliseconds.");
  const root = resolve(distRoot);
  const editor = join(root, "editor");
  const directory = join(editor, "assets");
  await ensurePlainDirectory(root);
  await ensurePlainDirectory(editor);
  await ensurePlainDirectory(directory);
  const inventoryFile = join(editor, "retained-assets.json");
  try {
    if (!(await lstat(inventoryFile)).isFile()) throw new Error("Local retained asset inventory is not a plain file.");
  } catch (error) { if (error.code !== "ENOENT") throw error; }

  const deadline = Date.now() + timeoutMs;
  let requests = 0;
  async function fetchBytes(path, types, maxBytes, missingAllowed = false) {
    if (++requests > MAX_ASSETS + 2) throw new Error("Too many retained asset requests.");
    if (Date.now() >= deadline) throw new Error(`Asset retention timed out: ${path}`);
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`Asset retention timed out: ${path}`));
      }, Math.max(0, Math.min(10_000, deadline - Date.now())));
    });
    try {
      return await Promise.race([timeout, (async () => {
        const url = new URL(path, base);
        const response = await fetchImpl(url, { redirect: "error", cache: "no-store", signal: controller.signal });
        if (response.redirected || response.url && response.url !== url.href) throw new Error(`Asset response changed destination: ${path}`);
        if (missingAllowed && response.status === 404) { void response.body?.cancel().catch(() => {}); return null; }
        if (response.status !== 200) throw new Error(`Cannot preserve ${path}: HTTP ${response.status}.`);
        const type = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
        if (!types.includes(type)) throw new Error(`Unexpected content type for ${path}: ${type ?? "missing"}.`);
        return readBoundedBody(response, maxBytes);
      })()]);
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }

  const local = new Map();
  let totalBytes = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `/editor/assets/${entry.name}`;
    assetExtension(path);
    if (!entry.isFile() || entry.isSymbolicLink()) throw new Error(`Retained asset is not a plain file: ${path}`);
    const { size } = await lstat(join(directory, entry.name));
    if (!size || size > MAX_ASSET_BYTES) throw new Error(`Invalid local asset size: ${path}`);
    totalBytes += size;
    local.set(path, true);
  }
  if (local.size > MAX_ASSETS || totalBytes > MAX_TOTAL_BYTES) throw new Error("Local editor assets exceed the release limit.");
  const sw = await fetchBytes("/editor/sw.js", TYPES.js, MAX_METADATA_BYTES);
  const deployed = await fetchBytes(INVENTORY_PATH, ["application/json"], MAX_METADATA_BYTES, true);
  // A missing first inventory bootstraps hosting metadata, not a project-format fallback.
  const paths = [...new Set([...local.keys(), ...precachePaths(sw.toString("utf8")), ...(deployed ? inventoryPaths(deployed.toString("utf8")) : [])])].sort();
  if (paths.length > MAX_ASSETS || totalBytes > MAX_TOTAL_BYTES) throw new Error("Retained editor assets exceed the release limit.");
  const downloads = [];
  for (const path of paths) {
    if (local.has(path)) continue;
    const bytes = await fetchBytes(path, TYPES[assetExtension(path)], Math.min(MAX_ASSET_BYTES, MAX_TOTAL_BYTES - totalBytes));
    totalBytes += bytes.length;
    downloads.push({ path, bytes });
  }
  // Validate every response before modifying output. Immutable assets are never overwritten.
  for (const { path, bytes } of downloads) await writeFile(join(root, path.slice(1)), bytes, { flag: "wx" });
  await writeFile(inventoryFile, `${JSON.stringify({ assets: paths })}\n`);
  return { assets: paths, downloaded: downloads.length, totalBytes };
}
