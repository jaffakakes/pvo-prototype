import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyAssistantDeployment } from "./assistant-deployment-preflight.mjs";
import { retainEditorAssets } from "./retain-editor-assets.mjs";
import {
  announceDeployedRelease,
  validateEditorReleaseRevision,
  waitForDeployedRelease,
} from "./wait-for-deployed-release.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const config = JSON.parse(await readFile(resolve(root, "wrangler.jsonc"), "utf8"));
const release = JSON.parse(await readFile(resolve(root, "dist/editor/release.json"), "utf8"));
const revision = validateEditorReleaseRevision(release.revision);
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

await waitForDeployedRelease({ origin, revision });
try {
  const { status } = await verifyAssistantDeployment({ origin });
  console.log(`Assistant preflight passed: ${status.model} provides editing, frames and transcription.`);
} catch (error) {
  throw new Error(`Deployment finished but assistant preflight failed: ${error.message} No release announced.`, { cause: error });
}
await announceDeployedRelease({ origin, revision, secret });
console.log(`Release announced: ${revision}`);
