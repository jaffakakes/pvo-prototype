import assert from "node:assert/strict";
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { requireFly } from "./api.mjs";
import { NODE_RUNTIME } from "../../../../server/cloud-services/node/runtime.js";
import { builderConfiguration } from "./image.mjs";

export async function cloudControllerFile() {
  const result = await build({
    entryPoints: [new URL("./cloud-control.mjs", import.meta.url).pathname],
    bundle: true,
    write: false,
    platform: "node",
    target: "node24",
    format: "esm",
    logLevel: "silent",
  });
  const content = result.outputFiles[0].text;
  assert.ok(Buffer.byteLength(content) < 256 * 1024);
  return {
    digest: createHash("sha256").update(content).digest("hex"),
    file: {
      guest_path: "/build-input/control.mjs",
      raw_value: Buffer.from(content).toString("base64"),
    },
  };
}
export function cloudControllerConfiguration(options) {
  const config = builderConfiguration(options);
  config.config.init.exec[4] = "/build-input/control.mjs";
  return config;
}

export async function observeCloudController(machine, resources) {
  const { report, save } = resources;
  const deadline = Date.now() + 540000;
  const startupDeadline = Date.now() + 120000;
  let startRequested = false;
  let hasStarted = false;
  let previousPhase;
  while (Date.now() < deadline) {
    let state;
    try {
      state = await requireFly(resources.request, "GET", machine.path);
    } catch (error) {
      if (["TypeError", "AbortError", "TimeoutError"].includes(error.name)) {
        await delay(1000);
        continue;
      }
      throw error;
    }
    assert.equal(state.image_ref?.digest, NODE_RUNTIME.baseImage.split("@")[1]);
    if (state.state === "stopped" && !startRequested) {
      startRequested = true;
      report.controllerStartAttempted = true;
      await save();
      try {
        await requireFly(
          resources.request,
          "POST",
          `${machine.path}/start`,
          {},
        );
      } catch (error) {
        if (!["TypeError", "AbortError", "TimeoutError"].includes(error.name))
          throw error;
        // The start may have succeeded. Observe this exact Machine; never send another start.
        report.controllerStartUncertain = true;
        await save();
      }
    } else if (state.state === "started") {
      hasStarted = true;
      let remote;
      try {
        const raw = await machine.command(
          [
            "node",
            "-e",
            `try{process.stdout.write(require('node:fs').readFileSync('/runtime/proof-status.json','utf8'))}catch{process.stdout.write('{"phase":"starting"}')}`,
          ],
          { timeoutMs: 12000 },
        );
        remote = JSON.parse(raw);
      } catch (error) {
        if (["TypeError", "AbortError", "TimeoutError"].includes(error.name)) {
          await delay(1000);
          continue;
        }
        throw error;
      }
      if (remote.phase !== "starting") {
        assert.equal(remote.id, report.id);
        assert.equal(remote.app, report.app);
        assert.equal(remote.controllerId, machine.record.id);
        assert.ok(
          Array.isArray(remote.machines) && remote.machines.length <= 9,
        );
        for (const row of remote.machines) {
          assert.match(row.name, new RegExp(`^restyle-${report.id}-0[1-9]$`));
          if (row.id !== null) assert.match(row.id, /^[a-f0-9]{10,32}$/);
          const index = report.machines.findIndex(
            (item) => item.name === row.name,
          );
          if (index < 0) report.machines.push(row);
          else report.machines[index] = row;
        }
        report.cloud = remote;
        report.checks = remote.checks;
        if (remote.build) report.build = remote.build;
        if (remote.networkPositiveControl)
          report.networkPositiveControl = remote.networkPositiveControl;
        await save();
      }
      const phase =
        remote.phase === "building"
          ? `build: ${remote.build?.phase ?? "starting"}`
          : remote.phase;
      if (phase !== previousPhase) {
        console.log(`Cloud proof: ${phase}`);
        previousPhase = phase;
      }
      if (remote.phase === "failed")
        throw new Error(
          `Cloud proof failed: ${remote.failure?.message ?? remote.cleanupFailure?.message ?? "unknown outcome"}`,
        );
      if (remote.phase === "passed") {
        assert.equal(remote.runtimeCasesPassed, true);
        assert.equal(remote.runtimeCleanupVerified, true);
        assert.equal(remote.build.sourceDigest, report.sourceDigest);
        report.runtimeCasesPassed = true;
        await save();
        return;
      }
    } else if (
      ["destroyed", "failed"].includes(state.state) ||
      (state.state === "stopped" && hasStarted)
    ) {
      throw new Error(
        `Cloud controller stopped before completion (${state.state})`,
      );
    }
    if (!hasStarted && Date.now() > startupDeadline)
      throw new Error("Cloud controller did not start within two minutes");
    await delay(1500);
  }
  throw new Error("Cloud proof outside deadline reached");
}
