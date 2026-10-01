import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { retainEditorAssets } from "./retain-editor-assets.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const config = JSON.parse(await readFile(resolve(root, "wrangler.jsonc"), "utf8"));
const { revision } = JSON.parse(await readFile(resolve(root, "dist/editor/release.json"), "utf8"));
const origin = config.vars.PUBLIC_ORIGIN;
const retained = await retainEditorAssets({ distRoot: resolve(root, "dist"), origin });
console.log(`Release assets: ${retained.assets.length} immutable editor files preserved (${retained.downloaded} downloaded).`);
const secretPath = resolve(root, ".wrangler/release-secrets.json");
await mkdir(resolve(root, ".wrangler"), { recursive: true });
let secret;
try {
  secret = JSON.parse(await readFile(secretPath, "utf8")).RELEASE_NOTIFY_TOKEN;
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
secret = process.env.RELEASE_NOTIFY_TOKEN || secret || randomBytes(32).toString("hex");
await writeFile(secretPath, JSON.stringify({ RELEASE_NOTIFY_TOKEN: secret }), { mode: 0o600 });

await new Promise((resolveDeploy, reject) => {
  const child = spawn(process.execPath, [resolve(root, "node_modules/wrangler/bin/wrangler.js"),
    "deploy", "--secrets-file", secretPath], { cwd: root, stdio: "inherit" });
  child.once("error", reject);
  child.once("exit", code => code === 0 ? resolveDeploy() : reject(new Error(`Deployment failed (${code}). No release announced.`)));
});

const served = await fetch(new URL("/editor/release.json", origin), { cache: "no-store" });
if (!served.ok || (await served.json()).revision !== revision)
  throw new Error("Deployment finished but the expected release is not served. No release announced.");
const response = await fetch(new URL("/api/releases/announce", origin), {
  method: "POST",
  headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
  body: JSON.stringify({ revision }),
});
if (!response.ok) throw new Error(`Deployment finished, but release announcement failed (${response.status}).`);
console.log(`Release announced: ${revision}`);
