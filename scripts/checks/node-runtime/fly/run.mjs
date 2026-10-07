import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { flyApi } from "./api.mjs";
import {
  flyRunnerFiles,
  flyMachineConfiguration,
  FLY_PROOF,
} from "./config.mjs";
import { flyProofResources } from "./resources.mjs";
import { FlyProofMachine } from "./machine.mjs";
import { checkLinuxIsolation } from "./namespace.mjs";
import { checkFlyNetwork } from "./network.mjs";
import { exerciseNode } from "../exercise.mjs";
import { parseNodeBundle } from "../../../../packages/pvo-assistant/services/index.js";

const [mode, org, journal] = process.argv.slice(2);
assert.ok(
  [
    "--dry-run",
    "--run-approved-fly-proof",
    "--run-approved-namespace-proof",
    "--cleanup",
  ].includes(mode),
);
if (mode === "--cleanup") assert.ok(journal, "Supply the recorded report.json");
const files = mode === "--cleanup" ? [] : await flyRunnerFiles();
let resources;
let request = () => {
  throw new Error("Dry run cannot access the Fly account");
};
if (mode !== "--dry-run") {
  // An explicit private file or environment variable; never print the value or put it in argv.
  const token = process.env.RESTYLE_FLY_TOKEN_FILE
    ? (await readFile(process.env.RESTYLE_FLY_TOKEN_FILE, "utf8")).trim()
    : process.env.FLY_API_TOKEN;
  const api = flyApi(token);
  request = async (...args) => {
    const result = await api(...args);
    if (!result.ok && result.status !== 404 && resources) {
      // Only fixed proof fixtures enter this private journal. Never print response/config bodies.
      const reason =
        typeof result.data?.error === "string" ? result.data.error : null;
      resources.report.providerFailure = {
        method: args[0],
        path: args[1],
        status: result.status,
        reason: reason?.replaceAll(token, "[redacted]").slice(0, 2048),
      };
      await resources.save();
    }
    return result;
  };
}
resources = await flyProofResources(request, org, {
  resumeReport: mode === "--cleanup" ? journal : null,
});
console.log(`Fly proof journal: ${resources.reportFile}`);
const { report } = resources;
async function withMachine(label, exercise) {
  const row = { label, startedAt: Date.now(), status: "pending" };
  report.checks.push(row);
  await resources.save();
  console.log(`Checking ${label}`);
  const record = await resources.createMachine(files);
  const machine = new FlyProofMachine(resources, record);
  let result;
  try {
    await machine.start();
    result = await exercise(machine);
  } catch (error) {
    row.status = "failed";
    row.durationMs = Date.now() - row.startedAt;
    await resources.save();
    throw error;
  } finally {
    await machine.destroy();
  }
  row.status = "passed";
  row.durationMs = Date.now() - row.startedAt;
  await resources.save();
  return result;
}
try {
  if (mode === "--dry-run") {
    flyMachineConfiguration({
      name: `restyle-${report.id}-00`,
      proofId: report.id,
      files,
    });
    report.dryRunPassed = true;
    report.runnerFiles = files.map(({ guest_path, raw_value }) => ({
      path: guest_path,
      bytes: Buffer.from(raw_value, "base64").length,
    }));
    await resources.save();
  } else if (mode !== "--cleanup") {
    report.plan.approved = true;
    await resources.save();
    await resources.createApp();
    if (mode === "--run-approved-namespace-proof") {
      report.namespaceCapability = await withMachine(
        "Linux namespace capability (fixed program only)",
        checkLinuxIsolation,
      );
      report.namespaceCapabilityPassed = true;
      await resources.save();
    } else {
      await withMachine(
        "Network positive control (fixed diagnostic only)",
        (machine) => checkFlyNetwork(machine, true),
      );
      await resources.restrictNetwork();
      await withMachine("Direct IPv4/IPv6 TCP/UDP denial", (machine) =>
        checkFlyNetwork(machine, false),
      );
      report.networkProbePassed = true;
      await resources.save();
      await exerciseNode(
        (label, source, { dependencies = [], failure = null } = {}) =>
          withMachine(label, async (machine) => {
            const bundle = parseNodeBundle({
              entrypoint: "src/main.mjs",
              files: [{ path: "src/main.mjs", content: source }],
              dependencies,
            });
            try {
              const value = await machine.execute(bundle, {
                operation: "probe",
                input: {},
                state: { retained: "outside guest" },
                now: 0,
              });
              assert.equal(
                failure,
                null,
                "Expected execution failure did not occur",
              );
              return value;
            } catch (error) {
              if (!failure) throw error;
              assert.equal(error.code, failure);
              return null;
            }
          }),
      );
      report.runtimeCasesPassed = true;
    }
    report.estimate = {
      date: "2026-10-07",
      computeUpperBoundUsd:
        FLY_PROOF.maxConcurrent *
        (FLY_PROOF.lifetimeMs / 3600000) *
        (2.19 / 720),
      basis:
        "iad shared-cpu-1x 256 MiB, all diagnostic wall time running; storage/network and other Restyle charges excluded",
      invoice: false,
    };
    await resources.save();
  }
} catch (error) {
  report.failure = {
    name: error.name,
    message: String(error.message).slice(0, 1000),
  };
  await resources.save();
  throw error;
} finally {
  try {
    await resources.cleanup();
  } catch (error) {
    report.cleanupFailure = {
      name: error.name,
      message: String(error.message).slice(0, 1000),
    };
    await resources.save();
    throw error;
  }
}
