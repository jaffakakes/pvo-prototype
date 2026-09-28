import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const outputRoot = resolve(process.argv[2] || resolve(repositoryRoot, "dist/editor"));
const workerSource = await readFile(resolve(repositoryRoot, "editor/public/sw.js"), "utf8");

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async entry => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? filesBelow(path) : [path];
  }));
  return files.flat();
}

const builtFiles = (await filesBelow(outputRoot))
  .map(path => relative(outputRoot, path).split(sep).join("/"))
  .filter(path => path !== "sw.js" && (path === "index.html"
    || path === "manifest.json"
    || path === "restyle-mark.png"
    || path === "apple-touch-icon.png"
    || /^icon-(192|512)\.png$/.test(path)
    || /\.(?:js|css|woff2|wasm)$/.test(path)))
  .sort();

for (const required of ["index.html", "manifest.json", "icon-192.png", "icon-512.png", "apple-touch-icon.png"]) {
  if (!builtFiles.includes(required)) throw new Error(`Editor PWA build is missing ${required}.`);
}
for (const extension of [".js", ".css", ".woff2", ".wasm"]) {
  if (!builtFiles.some(path => path.endsWith(extension))) throw new Error(`Editor PWA build is missing ${extension} assets.`);
}

const hash = createHash("sha256");
hash.update(workerSource);
for (const path of builtFiles) {
  hash.update(path);
  hash.update(await readFile(resolve(outputRoot, path)));
}
const cacheName = `restyle-editor-shell-${hash.digest("hex").slice(0, 16)}`;
const urls = builtFiles.map(path => `./${path}`);
if (!workerSource.includes('"__PVO_CACHE_NAME__"') || !workerSource.includes('["__PVO_PRECACHE_URLS__"]')) {
  throw new Error("Editor service-worker build placeholders are missing.");
}
const worker = workerSource
  .replace('"__PVO_CACHE_NAME__"', JSON.stringify(cacheName))
  .replace('["__PVO_PRECACHE_URLS__"]', JSON.stringify(urls));
await writeFile(resolve(outputRoot, "sw.js"), worker);
await writeFile(resolve(outputRoot, "release.json"), JSON.stringify({ revision: cacheName }) + "\n");
console.log(`Editor PWA: ${urls.length} app-shell assets precached in ${cacheName}.`);
