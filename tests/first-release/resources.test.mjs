import assert from "node:assert/strict";
import test from "node:test";
import { access, readFile, rm } from "node:fs/promises";
import { prepareResources } from "../../scripts/checks/cloud-agent-infrastructure/proof-resources.mjs";

test("interrupted diagnostic reopens its exact journal for deletion only and removes secrets after verified cleanup", async () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.CLOUDFLARE_API_TOKEN;
  process.env.CLOUDFLARE_API_TOKEN = "local-test-token";
  const requests = [];
  const accountId = "a".repeat(32);
  globalThis.fetch = async (url, init) => {
    requests.push({ url, method: init.method });
    const path = new URL(url).pathname;
    if (url.endsWith("/workers/subdomain"))
      return Response.json({
        success: true,
        result: { subdomain: "local-test" },
      });
    if (path.endsWith("/settings"))
      return Response.json({ success: false }, { status: 404 });
    if (
      path.endsWith("/containers/applications") ||
      path.endsWith("/durable_objects/namespaces")
    )
      return Response.json({ success: true, result: [] });
    assert.equal(
      init.method,
      "DELETE",
      "Recovery never creates or invokes a model",
    );
    return Response.json({ success: true });
  };
  let resources;
  try {
    resources = await prepareResources(accountId);
    const resource = await resources.prepare("workspace", {
      entrypoint: "scripts/checks/cloud-agent-first-release/worker.js",
      containerClassName: "AcceptanceWorkspace",
      loaderBinding: "SERVICE_LOADER",
      bindings: [
        { name: "ASSISTANT_WORKSPACES", class_name: "AcceptanceWorkspace" },
      ],
      vars: { ASSISTANT_PROVIDER: "runpod" },
      secrets: { RUNPOD_API_KEY: "local-model-secret" },
    });
    const config = JSON.parse(await readFile(resource.config, "utf8"));
    assert.equal(config.worker_loaders[0].binding, "SERVICE_LOADER");
    assert.equal(config.containers[0].class_name, "AcceptanceWorkspace");
    assert.equal(config.vars.ASSISTANT_PROVIDER, "runpod");
    assert.ok(!JSON.stringify(config).includes("local-model-secret"));
    assert.ok(
      !(await readFile(resources.reportFile, "utf8")).includes(
        "local-model-secret",
      ),
    );
    resource.attempted = true; // Lost deployment response; recovery must look up its recorded identity.
    await resources.save();
    const recovered = await prepareResources(accountId, {
      resumeReport: resources.reportFile,
    });
    await assert.rejects(recovered.prepare("workspace"), /cleanup-only/);
    await assert.rejects(
      recovered.deploy(recovered.report.resources[0]),
      /cleanup-only/,
    );
    await recovered.cleanup();
    assert.equal(recovered.report.cleanupVerified, true);
    assert.ok(
      requests.some(
        (r) =>
          r.method === "DELETE" &&
          r.url.includes(`/workers/scripts/${resource.name}`),
      ),
    );
    await assert.rejects(access(resource.secrets));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.CLOUDFLARE_API_TOKEN;
    else process.env.CLOUDFLARE_API_TOKEN = originalToken;
    if (resources)
      await rm(resources.directory, { recursive: true, force: true });
  }
});
