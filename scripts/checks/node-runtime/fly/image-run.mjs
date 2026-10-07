import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { flyApi } from "./api.mjs";
import { flyRunnerFiles } from "./config.mjs";
import { flyProofResources } from "./resources.mjs";
import { FlyProofMachine } from "./machine.mjs";
import { flyBuildCredentials } from "./credentials.mjs";
import { removeProofImage } from "./registry.mjs";
import { inspectRuntimeStartup } from "./startup.mjs";
import { checkFlyNetwork, networkProbeProgram } from "./network.mjs";
import {
  IMAGE_PROOF,
  imageBuildFiles,
  builderConfiguration,
  runtimeConfiguration,
  buildRuntimeImage,
} from "./image.mjs";
import { exerciseNode } from "../exercise.mjs";
import { parseNodeBundle } from "../../../../packages/pvo-assistant/services/index.js";

const [mode, org, journal] = process.argv.slice(2);
assert.ok(
  ["--dry-run", "--run-approved-image-proof", "--cleanup"].includes(mode),
);
if (mode === "--cleanup") assert.ok(journal);
const token =
  mode === "--dry-run"
    ? null
    : (await readFile(process.env.RESTYLE_FLY_TOKEN_FILE, "utf8")).trim();
const secrets = token ? [token] : [];
let resources;
const api = token ? flyApi(token) : null;
const request = async (...args) => {
  if (!api) throw new Error("Dry run cannot access Fly");
  const value = await api(...args);
  if (!value.ok && value.status !== 404 && resources) {
    let reason =
      typeof value.data?.error === "string" ? value.data.error : null;
    for (const secret of secrets)
      if (reason)
        reason = reason
          .replaceAll(secret, "[redacted]")
          .replaceAll(Buffer.from(secret).toString("base64"), "[redacted]");
    resources.report.providerFailure = {
      method: args[0],
      path: args[1],
      status: value.status,
      reason: reason?.slice(0, 2048),
    };
    await resources.save();
  }
  return value;
};
resources = await flyProofResources(request, org, {
  plan: IMAGE_PROOF,
  resumeReport: mode === "--cleanup" ? journal : null,
});
const credentialToken =
  mode === "--dry-run"
    ? null
    : (
        await readFile(
          process.env.RESTYLE_FLY_CREDENTIAL_TOKEN_FILE ??
            process.env.RESTYLE_FLY_TOKEN_FILE,
          "utf8",
        )
      ).trim();
if (credentialToken) secrets.push(credentialToken);
const credentials = credentialToken
  ? flyBuildCredentials(credentialToken, resources)
  : null;
const { report, save } = resources;
console.log(`Image proof journal: ${resources.reportFile}`);
async function withRuntime(
  label,
  source,
  { dependencies = [], failure = null, extraFiles = [] } = {},
) {
  const row = { label, startedAt: Date.now(), status: "pending" };
  report.checks.push(row);
  await save();
  console.log(`Checking ${label}`);
  const record = await resources.createMachine([], (options) =>
    runtimeConfiguration(report.build.image, options),
  );
  const machine = new FlyProofMachine(resources, record, {
    image: report.build.image,
    bridgePath: "/runtime/transport.mjs",
    executionMs: IMAGE_PROOF.transportDeadlineMs,
  });
  try {
    const startup = Date.now();
    await machine.start();
    row.startupMs = Date.now() - startup;
    const bundle = parseNodeBundle({
      entrypoint: "src/main.mjs",
      files: [{ path: "src/main.mjs", content: source }, ...extraFiles],
      dependencies,
    });
    let value;
    try {
      value = await machine.execute(bundle, {
        operation: "probe",
        input: {},
        state: { retained: "outside guest" },
        now: 0,
      });
      assert.equal(failure, null, "Expected execution failure did not occur");
    } catch (error) {
      if (!failure) throw error;
      assert.equal(error.code, failure);
      value = null;
    }
    row.status = "passed";
    return value;
  } catch (error) {
    row.status = "failed";
    if (row.startupMs === undefined)
      row.startup = await inspectRuntimeStartup(machine);
    throw error;
  } finally {
    await machine.destroy();
    row.durationMs = Date.now() - row.startedAt;
    await save();
  }
}
try {
  if (mode === "--dry-run") {
    const prepared = await imageBuildFiles(report.app, "unused-dry-run");
    const configuration = builderConfiguration({
      name: `restyle-${report.id}-00`,
      proofId: report.id,
      files: prepared.files,
    });
    assert.equal(configuration.config.guest.memory_mb, 1024);
    report.sourceDigest = prepared.sourceDigest;
    report.dryRunPassed = true;
    await save();
  } else if (mode !== "--cleanup") {
    report.plan.approved = true;
    await save();
    await resources.createApp();
    const credential = await credentials.create();
    secrets.push(credential);
    const prepared = await imageBuildFiles(report.app, credential);
    report.sourceDigest = prepared.sourceDigest;
    report.registryIntent = `registry.fly.io/${report.app}:runtime`;
    await save();
    const builder = await resources.createMachine(
      [...(await flyRunnerFiles()), ...prepared.files],
      builderConfiguration,
    );
    const machine = new FlyProofMachine(resources, builder);
    try {
      await machine.start();
      const image = await buildRuntimeImage(machine, resources);
      assert.equal(image.sourceDigest, prepared.sourceDigest);
      report.networkPositiveControl = await checkFlyNetwork(machine, true);
      await save();
    } catch (error) {
      report.builderFailure = {
        name: error.name,
        message: String(error.message).slice(0, 1000),
      };
      await save();
      throw error;
    } finally {
      await machine.destroy();
      await credentials.revoke();
    }
    await exerciseNode(withRuntime);
    const boundary = await withRuntime(
      "Packaged network, identity and host-file boundary",
      networkProbeProgram +
        `
import {existsSync,readFileSync} from 'node:fs';
export function execute({state}){return {result:{network,uid:process.getuid(),hostFiles:['/control','/sandbox','/.fly','/build','/run/restyle-registry-token','/runtime/supervisor.mjs','/proc/1/root/control'].filter(existsSync),status:readFileSync('/proc/self/status','utf8').split('\\n').filter(line=>/^(Cap|NoNewPrivs)/.test(line))},state};}`,
    );
    assert.deepEqual(boundary.result.network, {
      tcp4: false,
      tcp6: false,
      udp4: false,
      udp6: false,
    });
    assert.equal(boundary.result.uid, 1000);
    assert.deepEqual(boundary.result.hostFiles, []);
    assert.equal(
      boundary.result.status.filter((line) => /^Cap\w+:\s+0+$/.test(line))
        .length,
      5,
    );
    assert.ok(
      boundary.result.status.some((line) => /^NoNewPrivs:\s+1$/.test(line)),
    );
    const bounded = await withRuntime(
      "Large accepted source delivery",
      `export function execute({state}){return {result:'delivered',state};}`,
      {
        extraFiles: Array.from({ length: 9 }, (_, index) => ({
          path: `src/filler${index}.mjs`,
          content: "//" + "x".repeat(100000),
        })),
      },
    );
    assert.equal(bounded.result, "delivered");
    report.runtimeCasesPassed = true;
    await save();
  }
} catch (error) {
  report.failure = {
    name: error.name,
    message: String(error.message).slice(0, 1000),
  };
  await save();
  throw error;
} finally {
  const results = await Promise.allSettled([
    credentials?.revoke(),
    token ? removeProofImage(resources, token) : Promise.resolve(),
  ]);
  await resources.cleanup();
  for (const result of results)
    if (result.status === "rejected") throw result.reason;
}
