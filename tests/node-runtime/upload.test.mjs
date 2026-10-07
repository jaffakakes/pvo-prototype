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
        assert.equal(command, "docker");
        calls.push(args);
        if (args[0] === "context")
          return { stdout: "unix:///owned/docker.sock\n" };
        if (args.includes("build")) {
          assert.equal(
            args.includes("--config"),
            false,
            "Local build keeps installed Docker CLI plugins",
          );
          return { stdout: "built" };
        }
        assert.deepEqual(args.slice(0, 4), [
          "--config",
          resolve(directory, "docker-credentials"),
          "--host",
          "unix:///owned/docker.sock",
        ]);
        if (args.includes("login")) assert.equal(opts.input, "registry-secret");
        if (args.includes("push")) {
          assert.equal(saved, true);
          assert.equal(opts.timeoutMs, 600000);
          if (fail)
            throw Object.assign(new Error("stalled"), {
              stderr: "registry-secret account-secret",
            });
        }
        return {
          stdout: args.includes("inspect") ? JSON.stringify([image]) : "done",
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
      "\n[redacted] [redacted]",
    );
    await assert.rejects(access(resolve(directory, "docker-credentials")));
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
