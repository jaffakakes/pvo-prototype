import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import {
  imageBuildFiles,
  builderConfiguration,
} from "../node-runtime/fly/image.mjs";
import { FlyProofMachine } from "../node-runtime/fly/machine.mjs";
import { requireFly } from "../node-runtime/fly/api.mjs";
import { SERVICE_RUNTIME } from "../../../packages/pvo-assistant/services/index.js";

/** Build only the unchanged trusted runtime. No creator source or validation expectations enter the builder. */
export async function prepareProductImage(resources, credential) {
  const prepared = await imageBuildFiles(resources.report.app, credential);
  const content = "await import('./prepare.mjs'); setInterval(() => {}, 1000);";
  prepared.files.push({
    guest_path: "/build-input/build-only.mjs",
    raw_value: Buffer.from(content).toString("base64"),
  });
  resources.report.sourceDigest = prepared.sourceDigest;
  resources.report.registryIntent = `registry.fly.io/${resources.report.app}:runtime`;
  await resources.save();
  const builder = await resources.createMachine(prepared.files, (options) => {
    const config = builderConfiguration(options);
    config.config.init.exec[4] = "/build-input/build-only.mjs";
    return config;
  });
  const machine = new FlyProofMachine(resources, builder);
  const deadline = Date.now() + 540000;
  let started = false,
    previous;
  try {
    while (Date.now() < deadline) {
      const state = await requireFly(resources.request, "GET", machine.path);
      assert.equal(
        state.image_ref?.digest,
        SERVICE_RUNTIME.baseImage.split("@")[1],
      );
      if (state.state === "stopped" && !started) {
        started = true;
        await requireFly(
          resources.request,
          "POST",
          `${machine.path}/start`,
          {},
        );
      } else if (state.state === "started") {
        const raw = await machine.command(
          [
            "node",
            "-e",
            "try{process.stdout.write(require('node:fs').readFileSync('/runtime/image-status.json','utf8'))}catch{process.stdout.write('{\"phase\":\"starting\"}')}",
          ],
          { timeoutMs: 12000 },
        );
        const status = JSON.parse(raw);
        if (status.phase !== previous) {
          console.log(`Node image: ${status.phase}`);
          previous = status.phase;
        }
        resources.report.build = status;
        await resources.save();
        assert.notEqual(status.phase, "failed", status.message);
        if (status.phase === "passed") {
          assert.equal(status.sourceDigest, prepared.sourceDigest);
          assert.equal(
            status.image,
            `registry.fly.io/${resources.report.app}@${SERVICE_RUNTIME.imageDigest}`,
          );
          return status.image;
        }
      } else if (["failed", "destroyed"].includes(state.state))
        throw new Error("Image builder stopped unexpectedly");
      await delay(2000);
    }
    throw new Error("Image preparation outside deadline");
  } finally {
    await machine.destroy();
  }
}
