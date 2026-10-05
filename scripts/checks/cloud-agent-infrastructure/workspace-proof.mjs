import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { limits } from "./proof-http.js";
import { prepareResources } from "./proof-resources.mjs";

const accountId = process.argv[2];
if (process.argv[3] !== "--run" || !/^[a-f0-9]{32}$/.test(accountId || "")) {
  console.error(
    "Usage: node scripts/checks/cloud-agent-infrastructure/workspace-proof.mjs <account-id> --run",
  );
  process.exit(1);
}

const resources = await prepareResources(accountId);
const { report, call, save } = resources;
report.limits = limits;
report.runs = {};
report.sources = {};
for (const name of [
  "workspace-worker.js",
  "workspace-execution.js",
  "workspace-program.js",
  "service-worker.js",
  "proof-http.js",
]) {
  report.sources[name] = createHash("sha256")
    .update(await readFile(new URL(name, import.meta.url)))
    .digest("hex");
}
function expect(response, status, operation) {
  assert.equal(response.marker, resources.id, `${operation}: wrong deployment`);
  assert.equal(
    response.status,
    status,
    `${operation}: HTTP ${response.status}; ${JSON.stringify(response.data)}`,
  );
  return response.data;
}
async function check(description) {
  report.checks.push(description);
  console.log(description);
  await save();
}

try {
  const workspace = await resources.prepare("workspace");
  const service = await resources.prepare("service");
  await resources.deploy(workspace);
  await resources.ready(workspace);
  await resources.deploy(service);
  await resources.ready(service);
  expect(
    await call(workspace, "/status", "GET", undefined, false),
    401,
    "Workspace authentication",
  );
  expect(
    await call(service, "/status", "GET", undefined, false),
    401,
    "Service authentication",
  );
  await check("Both independent deployments reject unauthenticated requests.");

  console.log(
    "Running the fixed Linux build and self-test (maximum 15 seconds).",
  );
  const build = expect(
    await call(workspace, "/build", "POST"),
    200,
    "Linux build",
  );
  report.runs.build = build;
  await save();
  assert.equal(
    build.status,
    "completed",
    `Linux build failed: ${JSON.stringify(build)}`,
  );
  assert.equal(build.stopped, true);
  const state = expect(
    await call(workspace, "/status"),
    200,
    "Workspace stopped",
  );
  assert.equal(state.running, false);
  assert.equal(state.container, null);
  const artifact = expect(
    await call(workspace, "/artifact"),
    200,
    "Durable artifact",
  );
  assert.equal(artifact.platform, "linux");
  assert.equal(artifact.testsPassed, true);
  assert.equal(artifact.networkBlocked, true);
  assert.equal(
    createHash("sha256").update(artifact.source).digest("hex"),
    artifact.sha256,
  );
  await writeFile(
    resolve(resources.directory, "artifact.json"),
    JSON.stringify(artifact, null, 2),
    { mode: 0o600 },
  );
  report.artifact = {
    sha256: artifact.sha256,
    platform: artifact.platform,
    node: artifact.node,
    bytes: Buffer.byteLength(artifact.source),
  };
  expect(await call(workspace, "/build", "POST"), 409, "Duplicate build");
  await check(
    "Linux wrote and tested the service; its artifact remains readable after the VM stopped. A repeated build cannot create another VM.",
  );

  for (const kind of ["failure", "timeout"]) {
    console.log(`Checking ${kind} cleanup.`);
    const result = expect(await call(workspace, `/${kind}`, "POST"), 200, kind);
    report.runs[kind] = result;
    await save();
    assert.equal(result.status, "failed", `${kind}: ${JSON.stringify(result)}`);
    assert.equal(result.stopped, true);
    if (kind === "failure") assert.equal(result.exitCode, 7);
    else assert.equal(result.error, "command_timeout");
  }
  await check("Command failure and deadline both stop the VM.");

  const release = { source: artifact.source, sha256: artifact.sha256 };
  expect(
    await call(service, "/release", "PUT", release),
    200,
    "Install saved service",
  );
  expect(
    await call(service, "/release", "PUT", release),
    200,
    "Repeat installation",
  );
  const verifyAnswer = async () => {
    const answer = expect(
      await call(service, "/call", "POST", { value: 21 }),
      200,
      "Service result",
    );
    assert.deepEqual(answer, {
      answer: 42,
      credentialsReceived: false,
      envKeys: [],
    });
  };
  await verifyAnswer();
  await resources.remove(workspace);
  assert.deepEqual(workspace.storageDeletion.data, {
    deleted: true,
    running: false,
    artifactPresent: false,
  });
  await verifyAnswer();
  report.workspaceIndependentHostingPassed = true;
  await check(
    "Service still returns 42 after the workspace Worker, container application, saved workspace artifact and namespace were deleted.",
  );

  assert.deepEqual(
    expect(
      await call(service, "/network", "POST", {}),
      200,
      "Outbound isolation",
    ),
    { blocked: true },
  );
  expect(
    await call(service, "/call", "POST", "x".repeat(limits.requestBytes + 1)),
    413,
    "Request size limit",
  );
  assert.deepEqual(
    expect(
      await call(service, "/oversize", "POST", {}),
      502,
      "Response size limit",
    ),
    { error: "output_limit" },
  );
  assert.deepEqual(
    expect(await call(service, "/spin", "POST", {}), 502, "CPU limit"),
    { error: "cpu_limit" },
  );
  await verifyAnswer();
  await check(
    "Generated service has no bindings or caller credentials; outbound access, request bytes, response bytes and 50 ms CPU limit are enforced.",
  );

  const status = expect(await call(service, "/status"), 200, "Request count");
  const remaining = limits.calls - status.calls;
  const responses = await Promise.all(
    Array.from({ length: remaining + 3 }, () =>
      call(service, "/call", "POST", { value: 21 }),
    ),
  );
  assert.equal(
    responses.filter((response) => response.status === 200).length,
    remaining,
  );
  assert.equal(
    responses.filter((response) => response.status === 429).length,
    3,
  );
  assert.equal(
    expect(await call(service, "/status"), 200, "Final count").calls,
    limits.calls,
  );
  await check("Concurrent requests stop at exactly 20 admitted service calls.");
  assert.deepEqual(
    expect(await call(service, "/", "DELETE"), 200, "Erase release"),
    { deleted: true, sourcePresent: false },
  );
  expect(
    await call(service, "/call", "POST", { value: 21 }),
    410,
    "Deleted release unavailable",
  );
  report.liveWorkspaceProofPassed = true;
} catch (error) {
  report.failure = error.message;
  process.exitCode = 1;
} finally {
  await resources.cleanup();
  if (!report.cleanupVerified) process.exitCode = 1;
  console.log(
    JSON.stringify({ ...report, reportFile: resources.reportFile }, null, 2),
  );
}
