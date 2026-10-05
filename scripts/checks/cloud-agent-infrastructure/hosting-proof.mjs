import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createAccountReader, readCloudflareToken } from "./account.mjs";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("../../../", import.meta.url));
const wrangler = resolve(root, "node_modules/wrangler/bin/wrangler.js");
const accountId = process.argv[2];
if (process.argv[3] !== "--run" || !/^[a-f0-9]{32}$/.test(accountId || "")) {
  console.error(
    "Usage: node scripts/checks/cloud-agent-infrastructure/hosting-proof.mjs <account-id> --run",
  );
  process.exit(1);
}

const token = await readCloudflareToken();
const read = createAccountReader({ accountId, token });
const account = await read("workers/subdomain");
const subdomain = account.result?.subdomain;
assert.ok(
  account.ok &&
    typeof subdomain === "string" &&
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(subdomain),
  "Workers subdomain is unavailable",
);

const id = randomBytes(12).toString("hex");
const name = `restyle-infra-proof-${id}`;
const scriptPath = `workers/scripts/${name}/settings`;
const existing = await read(scriptPath);
assert.equal(
  existing.status,
  404,
  "Could not establish that the disposable name is unused",
);
const base = resolve(root, ".wrangler/cloud-agent-infrastructure");
await mkdir(base, { recursive: true, mode: 0o700 });
const directory = await mkdtemp(`${base}/hosting-`);
const config = resolve(directory, "wrangler.json");
const secrets = resolve(directory, "secrets.json");
const reportFile = resolve(directory, "report.json");
const proofToken = randomBytes(32).toString("hex");
const expiresAt = Date.now() + 10 * 60_000;
const url = `https://${name}.${subdomain}.workers.dev/proof`;
const report = {
  accountId,
  name,
  url,
  startedAt: new Date().toISOString(),
  expiresAt: new Date(expiresAt).toISOString(),
  fixture: "scripts/checks/cloud-agent-infrastructure/hosting-worker.js",
  hostingPassed: false,
  workspaceIndependentHostingPassed: false,
  cleanupVerified: false,
  stage: "prepared",
  checks: [],
  responses: [],
};
report.sourceSha256 = createHash("sha256")
  .update(await readFile(resolve(root, report.fixture)))
  .digest("hex");
const save = () =>
  writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, {
    mode: 0o600,
  });
await writeFile(
  config,
  JSON.stringify(
    {
      name,
      account_id: accountId,
      main: resolve(root, report.fixture),
      compatibility_date: "2026-10-05",
      workers_dev: true,
      preview_urls: false,
      observability: { enabled: false },
      vars: { PROOF_ID: id, PROOF_EXPIRES_AT: String(expiresAt) },
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
await writeFile(secrets, JSON.stringify({ PROOF_TOKEN: proofToken }), {
  mode: 0o600,
});
await save();

async function command(args, operation) {
  try {
    await execFileAsync(
      process.execPath,
      [wrangler, ...args, "--config", config],
      {
        cwd: root,
        timeout: 120_000,
        maxBuffer: 1024 * 1024,
        env: {
          ...process.env,
          CLOUDFLARE_API_TOKEN: token,
          WRANGLER_SEND_METRICS: "false",
          CI: "true",
        },
      },
    );
  } catch {
    // Do not expose captured command output, which may contain credential material.
    throw new Error(
      `${operation} failed or timed out. Inspect the private Wrangler log and resource journal.`,
    );
  }
}

async function call(headers = {}, method = "GET") {
  const response = await fetch(url, {
    method,
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  report.responses.push({
    method,
    status: response.status,
    fixture: response.headers.get("X-Restyle-Proof"),
    server: response.headers.get("server"),
  });
  return response;
}

try {
  report.stage = "deployment-attempted";
  await save(); // An interrupted upload may still create the Worker.
  console.log(`Deploying disposable Worker ${name}`);
  await command(["deploy", "--secrets-file", secrets], "Deployment");
  report.stage = "deployed";
  await save();
  let response;
  const headers = { Authorization: `Bearer ${proofToken}` };
  // Bound propagation checks to twelve requests. Never retry a live side effect.
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      response = await call(headers);
      if (response.headers.get("X-Restyle-Proof") === id) break;
      await response.body?.cancel();
    } catch {
      response = undefined;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  assert.equal(
    response?.status,
    200,
    "The deployed proof did not become available",
  );
  const expected = { proofId: id, runtime: "cloudflare-worker", answer: 42 };
  assert.deepEqual(await response.json(), expected);
  assert.equal(response.headers.get("X-Restyle-Proof"), id);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  report.checks.push(
    "Deployed URL returned the exact proof after the deploy process exited.",
  );
  const unauthorized = await call();
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.headers.get("X-Restyle-Proof"), id);
  await unauthorized.body?.cancel();
  report.checks.push("Unauthenticated request rejected.");
  const write = await call(headers, "POST");
  assert.equal(write.status, 405);
  assert.equal(write.headers.get("X-Restyle-Proof"), id);
  await write.body?.cancel();
  report.checks.push(
    "POST rejected; fixture cannot run submitted code or write data.",
  );
  const repeat = await call(headers);
  assert.equal(repeat.status, 200);
  assert.equal(repeat.headers.get("X-Restyle-Proof"), id);
  assert.deepEqual(await repeat.json(), expected);
  report.hostingPassed = true;
  report.stage = "hosting-verified";
  await save();
} catch (error) {
  report.failure = error.message;
  process.exitCode = 1;
} finally {
  console.log(`Removing disposable Worker ${name}`);
  try {
    // Only the recorded, randomly named Worker is targeted. No production configuration is loaded.
    const current = await read(scriptPath);
    if (current.status !== 404) await command(["delete", "--force"], "Cleanup");
    const removed = await read(scriptPath);
    assert.equal(removed.status, 404, "Worker absence could not be verified");
    report.cleanupVerified = true;
  } catch (error) {
    report.cleanupFailure = error.message;
    process.exitCode = 1;
  }
  report.stage = report.cleanupVerified ? "removed" : "cleanup-required";
  report.finishedAt = new Date().toISOString();
  await save();
  await rm(secrets, { force: true });
  console.log(JSON.stringify({ ...report, reportFile }, null, 2));
}
