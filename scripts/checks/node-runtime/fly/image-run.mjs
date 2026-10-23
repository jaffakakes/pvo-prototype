import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { flyApi } from "./api.mjs";
import { flyProofResources } from "./resources.mjs";
import { FlyProofMachine } from "./machine.mjs";
import { flyBuildCredentials } from "./credentials.mjs";
import { removeProofImage } from "./registry.mjs";
import { IMAGE_PROOF, imageBuildFiles } from "./image.mjs";
import {
  cloudControllerFile,
  cloudControllerConfiguration,
  observeCloudController,
} from "./cloud-observer.mjs";

const [mode, org, journal] = process.argv.slice(2);
assert.ok(
  ["--dry-run", "--run-approved-image-proof", "--cleanup"].includes(mode),
);
if (mode === "--cleanup") assert.ok(journal);
if (mode !== "--dry-run") {
  assert.ok(
    process.env.RESTYLE_CRANE_BIN,
    "Set RESTYLE_CRANE_BIN to the verified cleanup binary before creating resources",
  );
  await access(process.env.RESTYLE_CRANE_BIN, constants.X_OK);
}
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

try {
  if (mode === "--dry-run") {
    const prepared = await imageBuildFiles(report.app, "unused-dry-run");
    const control = await cloudControllerFile();
    const configuration = cloudControllerConfiguration({
      name: `restyle-${report.id}-00`,
      proofId: report.id,
      files: [...prepared.files, control.file],
    });
    assert.equal(configuration.config.guest.memory_mb, 1024);
    report.sourceDigest = prepared.sourceDigest;
    report.controlDigest = control.digest;
    report.dryRunPassed = true;
    await save();
  } else if (mode !== "--cleanup") {
    report.plan.approved = true;
    await save();
    await resources.createApp();
    const credential = await credentials.create();
    secrets.push(credential);
    const prepared = await imageBuildFiles(report.app, credential);
    const control = await cloudControllerFile();
    report.controlDigest = control.digest;
    report.sourceDigest = prepared.sourceDigest;
    report.registryIntent = `registry.fly.io/${report.app}:runtime`;
    await save();
    const builder = await resources.createMachine(
      [...prepared.files, control.file],
      cloudControllerConfiguration,
    );
    const machine = new FlyProofMachine(resources, builder);
    try {
      await observeCloudController(machine, resources);
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
