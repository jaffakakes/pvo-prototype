import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { proofProcess } from "./proof-process.mjs";

/** Upload the owned image explicitly; Wrangler receives only its immutable registry reference. */
export async function uploadProofImage(
  resource,
  {
    accountId,
    token,
    directory,
    save,
    run = proofProcess,
    fetchImpl = fetch,
    crane = process.env.RESTYLE_CRANE_BIN ?? "crane",
    dryRun = false,
  },
) {
  assert.equal(resource.imageOwnershipVerified, true);
  if (!dryRun) assert.equal(resource.attempted, true);
  const config = JSON.parse(await readFile(resource.config, "utf8"));
  const source = config.containers[0].images.runtime;
  assert.ok(source.dockerfile && source.build_context);
  const registry = "registry.cloudflare.com";
  const tag = `${registry}/${accountId}/${resource.imageRepository}:proof`;
  const dockerConfig = resolve(directory, "docker-credentials");
  const archive = resolve(directory, "runtime-image.tar");
  await mkdir(dockerConfig, { mode: 0o700 });
  let password = "";
  async function command(label, binary, args, input, timeoutMs = 60_000) {
    let result;
    try {
      result = await run(binary, args, {
        input,
        timeoutMs,
        env:
          binary === "docker"
            ? process.env
            : { ...process.env, DOCKER_CONFIG: dockerConfig },
      });
      return result;
    } catch (error) {
      result = error;
      throw new Error(`Image ${label} failed; see private image-${label}.log`);
    } finally {
      let diagnostic = `${result?.stdout ?? ""}\n${result?.stderr ?? ""}${result instanceof Error ? "\n" + result.message : ""}`;
      for (const secret of [token, password])
        if (secret) diagnostic = diagnostic.replaceAll(secret, "[redacted]");
      diagnostic = diagnostic.replace(
        /(https:\/\/[^\s?"']+)\?[^\s"']+/g,
        "$1?[redacted]",
      );
      await writeFile(resolve(directory, `image-${label}.log`), diagnostic, {
        mode: 0o600,
      });
    }
  }
  try {
    const version = await command("tool", crane, ["version"]);
    assert.equal(
      version.stdout.trim().replace(/^v/, ""),
      "0.22.1",
      "Use the reviewed crane v0.22.1 uploader",
    );
    resource.imageUploader = { name: "crane", version: "v0.22.1" };
    await save();
    // Build locally; upload from the host rather than through Docker Desktop networking.
    const context = await run("docker", [
      "context",
      "inspect",
      "--format",
      "{{.Endpoints.docker.Host}}",
    ]);
    const dockerHost = context.stdout.trim();
    assert.match(dockerHost, /^unix:\/\//);
    const host = ["--host", dockerHost];
    await command(
      "build",
      "docker",
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
    await command(
      "archive",
      "docker",
      [...host, "image", "save", "--output", archive, tag],
      undefined,
      300_000,
    );
    const expected = (
      await command("local-digest", crane, [
        "digest",
        "--tarball",
        archive,
        tag,
      ])
    ).stdout.trim();
    assert.match(expected, /^sha256:[a-f0-9]{64}$/);
    resource.imageLocalDigest = expected;
    await save();
    if (dryRun) return;
    const response = await fetchImpl(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/containers/registries/${registry}/credentials`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          expiration_minutes: 45,
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
    await command(
      "login",
      crane,
      [
        "auth",
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
    await command("push", crane, ["push", archive, tag], undefined, 1_800_000);
    const actual = (
      await command("remote-digest", crane, ["digest", tag])
    ).stdout.trim();
    assert.equal(
      actual,
      expected,
      "Remote image differs from the built archive",
    );
    const image = `${registry}/${accountId}/${resource.imageRepository}@${actual}`;
    resource.imageDigest = image;
    await save();
    config.containers[0].images.runtime = { image };
    await writeFile(resource.config, JSON.stringify(config, null, 2), {
      mode: 0o600,
    });
  } finally {
    await rm(dockerConfig, { recursive: true, force: true });
    await rm(archive, { force: true });
  }
}
