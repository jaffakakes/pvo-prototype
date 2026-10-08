import { readFile, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertBetaDeployment } from "./beta-deployment-config.mjs";
import {
  announceDeployedRelease,
  validateEditorReleaseRevision,
  waitForDeployedRelease,
} from "./wait-for-deployed-release.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const dryRun = process.argv.slice(2).includes("--dry-run");
if (process.argv.slice(2).some((value) => value !== "--dry-run"))
  throw new Error(
    "Use only --dry-run; beta targets come from the guarded configuration.",
  );
const configFile = join(root, "wrangler.beta.jsonc");
const config = assertBetaDeployment(
  JSON.parse(await readFile(configFile, "utf8")),
);
const release = JSON.parse(
  await readFile(
    join(root, ".wrangler/beta/assets/editor/release.json"),
    "utf8",
  ),
);
const revision = validateEditorReleaseRevision(release.revision);
const secretsFile =
  process.env.RESTYLE_BETA_SECRETS_FILE ||
  join(homedir(), ".codex/secure/restyle-beta-backend/worker-secrets.json");
let secrets;
if (!dryRun) {
  const details = await stat(secretsFile);
  if (
    !details.isFile() ||
    (process.platform !== "win32" && details.mode & 0o077)
  )
    throw new Error("Beta Worker secrets require a private file.");
  secrets = JSON.parse(await readFile(secretsFile, "utf8"));
  for (const name of [
    "SESSION_SECRET",
    "ACCOUNT_CONNECTION_KEY",
    "RELEASE_NOTIFY_TOKEN",
    "RUNPOD_API_KEY",
    "ASSISTANT_TASK_SPENDING",
  ]) {
    if (typeof secrets[name] !== "string" || !secrets[name].trim())
      throw new Error(
        `Configure the private beta secret ${name} before deployment.`,
      );
  }
  if (!Array.isArray(JSON.parse(secrets.ASSISTANT_TASK_SPENDING)))
    throw new Error("Configure a private beta account-grant array.");
}
const args = [
  join(root, "node_modules/wrangler/bin/wrangler.js"),
  "deploy",
  "--config",
  configFile,
  "--strict",
  ...(dryRun
    ? ["--dry-run", "--outdir", join(root, ".wrangler/beta/dry-run")]
    : ["--secrets-file", secretsFile]),
];
await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "true" },
  });
  child.once("error", () =>
    reject(new Error("The guarded beta deployment could not start.")),
  );
  child.once("exit", (code) =>
    code === 0
      ? resolve()
      : reject(
          new Error(`Beta deployment failed (${code}); no release announced.`),
        ),
  );
});
if (!dryRun) {
  const origin = config.vars.PUBLIC_ORIGIN;
  await waitForDeployedRelease({ origin, revision });
  await announceDeployedRelease({
    origin,
    revision,
    secret: secrets.RELEASE_NOTIFY_TOKEN,
  });
  console.log(`Beta release announced: ${revision}`);
}
