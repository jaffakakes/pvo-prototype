import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { NODE_RUNTIME } from "../../../../server/cloud-services/node/runtime.js";
import { flyMachineConfiguration } from "./config.mjs";

export const IMAGE_PROOF = Object.freeze({
  region: "iad",
  maxMachines: 10,
  lifetimeMs: 60 * 60_000,
  machineLifetimeSeconds: 120,
  memoryMiB: 1024,
  maxConcurrent: 2,
  builderMemoryMiB: 1024,
  builderLifetimeSeconds: 600,
  builderRootfsGiB: 4,
  estimateUsd: 1,
  transportDeadlineMs: 5000,
});

export async function imageBuildFiles(app, token) {
  const sources = await Promise.all(
    [
      "server.mjs",
      "files.mjs",
      "bridge.mjs",
      "sandbox.mjs",
      "supervisor.mjs",
      "transport.mjs",
    ].map(async (path) => ({
      path,
      content: await readFile(
        new URL(
          `../../../../server/cloud-services/node/guest/${path}`,
          import.meta.url,
        ),
        "utf8",
      ),
    })),
  );
  const sourceDigest = createHash("sha256")
    .update(JSON.stringify(sources))
    .digest("hex");
  const files = sources.map((file) => ({
    path: `/build-input/${file.path}`,
    content: file.content,
  }));
  for (const path of ["prepare.mjs", "download.mjs", "extract.mjs"])
    files.push({
      path: `/build-input/${path}`,
      content: await readFile(
        new URL(`../../../build/node-runtime/${path}`, import.meta.url),
        "utf8",
      ),
    });
  files.push({
    path: "/build-input/settings.json",
    content: JSON.stringify({
      app,
      sourceDigest,
      baseImage: NODE_RUNTIME.baseImage,
    }),
  });
  files.push({ path: "/run/restyle-registry-token", content: token });
  return {
    sourceDigest,
    files: files.map(({ path, content }) => ({
      guest_path: path,
      raw_value: Buffer.from(content).toString("base64"),
    })),
  };
}

export function builderConfiguration(options) {
  const value = flyMachineConfiguration(options);
  value.config.guest.memory_mb = IMAGE_PROOF.builderMemoryMiB;
  value.config.rootfs = {
    size_gb: IMAGE_PROOF.builderRootfsGiB,
    persist: "never",
  };
  value.config.init.exec[2] = String(IMAGE_PROOF.builderLifetimeSeconds);
  return value;
}

export function runtimeConfiguration(image, options) {
  assert.match(
    image,
    /^registry\.fly\.io\/restyle-node-proof-[a-f0-9]{24}@sha256:[a-f0-9]{64}$/,
  );
  const value = flyMachineConfiguration(options);
  value.config.image = image;
  value.config.guest.memory_mb = IMAGE_PROOF.memoryMiB;
  value.config.init.exec[4] = "/runtime/supervisor.mjs";
  return value;
}
