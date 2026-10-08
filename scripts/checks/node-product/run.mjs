import { randomBytes } from "node:crypto";
import { exerciseConnected } from "../connected-services/exercise.mjs";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { flyApi } from "../node-runtime/fly/api.mjs";
import { flyProofResources } from "../node-runtime/fly/resources.mjs";
import { flyBuildCredentials } from "../node-runtime/fly/credentials.mjs";
import { removeProofImage } from "../node-runtime/fly/registry.mjs";
import { SERVICE_RUNTIME } from "../../../packages/pvo-assistant/services/index.js";
import { prepareProductImage } from "./image.mjs";
import { productWorker } from "./resources.mjs";
import { exerciseProduct } from "./exercise.mjs";
import { checkProductBrowser } from "./browser.mjs";
import { checkComputeRestart } from "./interruption.mjs";

const connected = process.env.RESTYLE_NODE_ACCEPTANCE === "connected";
const [mode, org, accountId, journal] = process.argv.slice(2);
assert(["--dry-run", "--run-approved", "--cleanup"].includes(mode));
assert.match(accountId ?? "", /^[a-f0-9]{32}$/);
const dryRun = mode === "--dry-run",
  cleanup = mode === "--cleanup";
if (cleanup) assert(journal);
if (!dryRun) {
  assert(process.env.RESTYLE_CRANE_BIN);
  await access(process.env.RESTYLE_CRANE_BIN, constants.X_OK);
}
let githubToken =
  connected && !dryRun && !cleanup
    ? (await readFile(process.env.RESTYLE_GITHUB_TOKEN_FILE, "utf8")).trim()
    : null;
const token = dryRun
  ? null
  : (await readFile(process.env.RESTYLE_FLY_TOKEN_FILE, "utf8")).trim();
const fly = await flyProofResources(
  token
    ? flyApi(token)
    : async () => {
        throw new Error("No Fly effects during dry run");
      },
  org,
  {
    resumeReport: cleanup ? journal : null,
    plan: {
      lifetimeMs: 3600000,
      maxMachines: 1,
      maxExecutions: 32,
      maxConcurrent: 2,
      memoryMiB: 1024,
      region: "iad",
      estimateUsd: 1,
    },
  },
);
const { report, save } = fly;
const credentialToken = dryRun
  ? null
  : (
      await readFile(
        process.env.RESTYLE_FLY_CREDENTIAL_TOKEN_FILE ??
          process.env.RESTYLE_FLY_TOKEN_FILE,
        "utf8",
      )
    ).trim();
const credentials = token
  ? flyBuildCredentials(credentialToken, fly, { expiry: "1h" })
  : null;
let worker;
console.log(`Product acceptance journal: ${fly.reportFile}`);
try {
  if (cleanup) {
    if (report.cloudJournal)
      worker = await productWorker(accountId, fly, { cleanup: true });
  } else {
    let scoped = "dry-run-not-a-credential",
      image = `registry.fly.io/${report.app}@${SERVICE_RUNTIME.imageDigest}`;
    if (!dryRun) {
      report.plan.approved = true;
      await save();
      await fly.createApp();
      scoped = await credentials.create();
      image = await prepareProductImage(fly, scoped);
    }
    worker = await productWorker(accountId, fly, {
      token: scoped,
      image,
      dryRun,
      ...(connected
        ? {
            entrypoint: "scripts/checks/connected-services/worker.js",
            secrets: {
              ACCOUNT_CONNECTION_KEY: randomBytes(32).toString("hex"),
            },
          }
        : {}),
    });
    if (dryRun) {
      report.dryRunPassed = true;
      await save();
    } else {
      const record = async (name, evidence) => {
        report.checks.push({ name, evidence, at: Date.now() });
        const usage = await worker.call("/usage");
        if (usage.status === 200) report.usage = usage.data;
        await save();
        console.log(`Product check passed: ${name}`);
      };
      const browserCheck = (options) =>
        checkProductBrowser({
          ...options,
          origin: worker.resource.url,
          directory: worker.resources.directory,
        });
      if (connected) {
        await exerciseConnected({
          call: worker.call,
          record,
          token: githubToken,
          browserCheck,
        });
        githubToken = null;
      } else
        await exerciseProduct({
          call: worker.call,
          record,
          interruptionCheck: checkComputeRestart,
          browserCheck,
        });
      report.productCasesPassed = true;
      await save();
    }
  }
} catch (error) {
  report.failure = {
    name: error.name,
    message: String(error.message)
      .replaceAll(token || "never-a-token", "[redacted]")
      .replaceAll(githubToken || "never-a-github-token", "[redacted]")
      .slice(0, 2000),
  };
  await save();
  process.exitCode = 1;
  console.error(report.failure.message);
} finally {
  try {
    if (!worker && report.cloudJournal)
      worker = await productWorker(accountId, fly, { cleanup: true });
    await worker?.cleanup();
    if (token) await removeProofImage(fly, token);
    await fly.cleanup();
    await credentials?.revoke();
  } catch (error) {
    report.cleanupFailure = { message: String(error.message).slice(0, 1000) };
    report.cleanupVerified = false;
    await save();
    process.exitCode = 1;
    console.error(
      "Cleanup remains pending; preserve the journal and credentials.",
    );
  }
}
