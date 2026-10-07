import assert from "node:assert/strict";
import test from "node:test";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { uploadProofImage } from "../../scripts/checks/cloud-agent-infrastructure/proof-image-upload.mjs";

test("only a completed owned upload selects a pinned deployment image and credentials always disappear", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "restyle-upload-"));
  try {
    const resource = {
      config: resolve(directory, "worker.json"),
      imageRepository: "owned-proof-image",
      imageOwnershipVerified: true,
      attempted: true,
    };
    const original = {
      containers: [
        {
          images: {
            runtime: {
              dockerfile: "/owned/Dockerfile",
              build_context: "/owned",
            },
          },
        },
      ],
    };
    const accountId = "a".repeat(32);
    const image = `registry.cloudflare.com/${accountId}/owned-proof-image@sha256:${"b".repeat(64)}`;
    let fail = true,
      saved = false;
    const calls = [];
    const options = {
      accountId,
      token: "account-secret",
      directory,
      save: async () => {
        saved = true;
      },
      fetchImpl: async (url, init) => {
        assert.ok(
          url.endsWith("/registries/registry.cloudflare.com/credentials"),
        );
        assert.equal(init.headers.Authorization, "Bearer account-secret");
        return Response.json({
          success: true,
          result: { username: "owned-account", password: "registry-secret" },
        });
      },
      run: async (command, args, opts) => {
        calls.push(args);
        if (command === "docker") {
          if (args[0] === "context")
            return { stdout: "unix:///owned/docker.sock\n" };
          assert.equal(
            args.includes("--config"),
            false,
            "Local Docker keeps installed plugins",
          );
          assert.deepEqual(args.slice(0, 2), [
            "--host",
            "unix:///owned/docker.sock",
          ]);
          return { stdout: "built/exported" };
        }
        assert.equal(command, "crane");
        assert.equal(
          opts.env.DOCKER_CONFIG,
          resolve(directory, "docker-credentials"),
        );
        if (args[0] === "version") return { stdout: "v0.22.1" };
        if (args.includes("login")) assert.equal(opts.input, "registry-secret");
        if (args.includes("push")) {
          assert.equal(saved, true);
          assert.equal(opts.timeoutMs, 1800000);
          if (fail)
            throw Object.assign(new Error("stalled"), {
              stderr: "registry-secret account-secret",
            });
        }
        return {
          stdout: args[0] === "digest" ? "sha256:" + "b".repeat(64) : "done",
        };
      },
    };
    await writeFile(resource.config, JSON.stringify(original));
    await assert.rejects(
      uploadProofImage(resource, options),
      /Image push failed/,
    );
    assert.deepEqual(JSON.parse(await readFile(resource.config)), original);
    assert.equal(resource.imageDigest, undefined);
    assert.equal(
      await readFile(resolve(directory, "image-push.log"), "utf8"),
      "\n[redacted] [redacted]\nstalled",
    );
    await assert.rejects(access(resolve(directory, "docker-credentials")));
    const before = calls.length;
    await uploadProofImage(
      { ...resource, attempted: false },
      {
        ...options,
        dryRun: true,
        fetchImpl: async () => {
          throw new Error("Dry run requested upload credentials");
        },
      },
    );
    assert.ok(
      !calls
        .slice(before)
        .some((args) => args.includes("push") || args.includes("login")),
    );
    assert.deepEqual(JSON.parse(await readFile(resource.config)), original);
    fail = false;
    await uploadProofImage(resource, options);
    assert.equal(resource.imageDigest, image);
    assert.deepEqual(
      JSON.parse(await readFile(resource.config)).containers[0].images.runtime,
      { image },
    );
    assert.ok(calls.some((args) => args.includes("--provenance=false")));
    await assert.rejects(access(resolve(directory, "docker-credentials")));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
