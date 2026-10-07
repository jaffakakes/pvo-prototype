import assert from "node:assert/strict";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { flyApi } from "./api.mjs";
import { cloudProofResources } from "./cloud-resources.mjs";
import { runImageCases } from "./image-cases.mjs";
import { networkProbeProgram } from "./network.mjs";

// This fixed trusted program is never part of the runtime image or an execution guest.
const settings = JSON.parse(
  await readFile("/build-input/settings.json", "utf8"),
);
const token = (await readFile("/run/restyle-registry-token", "utf8")).trim();
await mkdir("/runtime", { recursive: true, mode: 0o700 });
const report = {
  app: settings.app,
  id: settings.app.replace("restyle-node-proof-", ""),
  controllerId: process.env.FLY_MACHINE_ID,
  startedAt: Date.now(),
  deadlineAt: Date.now() + 540000,
  phase: "building",
  machines: [],
  checks: [],
  runtimeCleanupVerified: false,
};
const save = async () => {
  await writeFile("/runtime/proof-status.next", JSON.stringify(report), {
    mode: 0o600,
  });
  await rename("/runtime/proof-status.next", "/runtime/proof-status.json");
};
await save();
const resources = cloudProofResources(flyApi(token), report, save);
async function build() {
  const child = spawn(process.execPath, ["/build-input/prepare.mjs"], {
    detached: true,
    stdio: "ignore",
    env: { PATH: "/usr/local/bin:/usr/bin:/bin" },
  });
  let outcome = null;
  child.once("error", (error) => (outcome = { error: error.message }));
  child.once("exit", (code) => (outcome = { code }));
  const deadline = Date.now() + 480000;
  try {
    while (!outcome && Date.now() < deadline) {
      try {
        report.build = JSON.parse(
          await readFile("/runtime/image-status.json", "utf8"),
        );
        await save();
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      await delay(500);
    }
    assert.equal(
      outcome?.code,
      0,
      "Trusted build process did not finish successfully",
    );
    report.build = JSON.parse(
      await readFile("/runtime/image-status.json", "utf8"),
    );
    assert.equal(report.build.phase, "passed");
    assert.equal(report.build.sourceDigest, settings.sourceDigest);
    assert.match(
      report.build.image,
      new RegExp(`^registry\\.fly\\.io/${report.app}@sha256:[a-f0-9]{64}$`),
    );
    await save();
  } finally {
    if (child.pid)
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
  }
}
try {
  await build();
  // Fixed positive controls run outside the sandbox; no account data is sent.
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      networkProbeProgram + "process.stdout.write(JSON.stringify(network))",
    ],
    { stdio: ["ignore", "pipe", "ignore"], timeout: 5000 },
  );
  const chunks = [];
  child.stdout.on("data", (part) => chunks.push(part));
  await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error("Network control failed")),
    );
  });
  report.networkPositiveControl = JSON.parse(
    Buffer.concat(chunks).toString("utf8"),
  );
  assert.deepEqual(report.networkPositiveControl, {
    tcp4: true,
    tcp6: true,
    udp4: true,
    udp6: true,
  });
  report.phase = "runtime-cases";
  await save();
  await runImageCases(resources);
  report.runtimeCasesPassed = true;
} catch (error) {
  report.failure = {
    name: error.name,
    message: String(error.message)
      .replaceAll(token, "[redacted]")
      .slice(0, 1000),
  };
  process.exitCode = 1;
} finally {
  try {
    await resources.cleanup();
  } catch (error) {
    report.cleanupFailure = { message: String(error.message).slice(0, 500) };
    process.exitCode = 1;
  }
  report.phase =
    report.runtimeCasesPassed && report.runtimeCleanupVerified
      ? "passed"
      : "failed";
  report.finishedAt = Date.now();
  await save();
}
// Stay inspectable until the outside parent verifies and destroys this controller.
setInterval(() => {}, 1000);
