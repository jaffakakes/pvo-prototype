import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { proofProcess } from "./proof-process.mjs";

/** Upload the owned image explicitly; Wrangler receives only its immutable registry reference. */
export async function uploadProofImage(
  resource,
  { accountId, token, directory, save, run = proofProcess, fetchImpl = fetch },
) {
  assert.equal(resource.imageOwnershipVerified, true);
  assert.equal(resource.attempted, true);
  const config = JSON.parse(await readFile(resource.config, "utf8"));
  const source = config.containers[0].images.runtime;
  assert.ok(source.dockerfile && source.build_context);
  const registry = "registry.cloudflare.com";
  const tag = `${registry}/${accountId}/${resource.imageRepository}:proof`;
  const dockerConfig = resolve(directory, "docker-credentials");
  await mkdir(dockerConfig, { mode: 0o700 });
  let password = "";
  async function docker(label, args, input, timeoutMs = 60_000) {
    let result;
    try {
      result = await run(
        "docker",
        [...(label === "build" ? [] : ["--config", dockerConfig]), ...args],
        {
          input,
          timeoutMs,
        },
      );
      return result;
    } catch (error) {
      result = error;
      throw new Error(`Image ${label} failed; see private image-${label}.log`);
    } finally {
      let diagnostic = `${result?.stdout ?? ""}\n${result?.stderr ?? ""}`;
      for (const secret of [token, password])
        if (secret) diagnostic = diagnostic.replaceAll(secret, "[redacted]");
      await writeFile(resolve(directory, `image-${label}.log`), diagnostic, {
        mode: 0o600,
      });
    }
  }
  try {
    // Use the local daemon explicitly; an isolated Docker config contains no saved account login.
    const context = await run("docker", [
      "context",
      "inspect",
      "--format",
      "{{.Endpoints.docker.Host}}",
    ]);
    const dockerHost = context.stdout.trim();
    assert.match(dockerHost, /^unix:\/\//);
    const host = ["--host", dockerHost];
    await docker(
      "build",
      [
        ...host,
        "build",
        "--platform",
        "linux/amd64",
        "--provenance=false",
        "--tag",
        tag,
        "--file",
        source.dockerfile,
        source.build_context,
      ],
      undefined,
      300_000,
    );
    const response = await fetchImpl(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/containers/registries/${registry}/credentials`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          expiration_minutes: 15,
          permissions: ["push", "pull"],
        }),
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      },
    );
    const body = await response.json();
    assert.ok(
      response.ok &&
        body.success &&
        body.result?.username &&
        body.result?.password,
      "Registry upload credentials unavailable",
    );
    password = body.result.password;
    await docker(
      "login",
      [
        ...host,
        "login",
        "--password-stdin",
        "--username",
        body.result.username,
        registry,
      ],
      password,
    );
    resource.imageTags = [`${resource.imageRepository}:proof`];
    await save();
    await docker("push", [...host, "push", tag], undefined, 600_000);
    const inspected = await docker("inspect", [
      ...host,
      "image",
      "inspect",
      "--format",
      "{{json .RepoDigests}}",
      tag,
    ]);
    const image = JSON.parse(inspected.stdout).find((value) =>
      value.startsWith(
        `${registry}/${accountId}/${resource.imageRepository}@sha256:`,
      ),
    );
    assert.ok(
      image && /@sha256:[a-f0-9]{64}$/.test(image),
      "Uploaded image digest unavailable",
    );
    resource.imageDigest = image;
    await save();
    config.containers[0].images.runtime = { image };
    await writeFile(resource.config, JSON.stringify(config, null, 2), {
      mode: 0o600,
    });
  } finally {
    await rm(dockerConfig, { recursive: true, force: true });
  }
}
