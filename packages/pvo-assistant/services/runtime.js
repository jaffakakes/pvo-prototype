import { object, requireTask } from "../tasks/validation.js";

/** Immutable hosted image identity, retained with every checked package and release. */
export const SERVICE_RUNTIME = Object.freeze({
  name: "nodejs-esm",
  nodeVersion: "24.20.0",
  baseImage:
    "node@sha256:6642ef280aebc09c4541bee0b15c9f89f0f3f3c247ddee79ae1d37eddfdcbbaa",
  runnerDigest:
    "73dc5f1be4113b457ed0c64b4b3abc168e038ae092ae9a8c64a355718dc0c7dc",
  imageDigest:
    "sha256:9942e6c3dccc44a923c70ef9d8b3b7609b1a8338ea05b33ca80047952d0f449b",
});

export function parseServiceRuntime(value) {
  object(value, Object.keys(SERVICE_RUNTIME), "Hosted Node runtime");
  for (const key of Object.keys(SERVICE_RUNTIME))
    requireTask(
      value[key] === SERVICE_RUNTIME[key],
      "Unsupported or changed hosted Node runtime.",
    );
  return structuredClone(value);
}
