import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createAccountReader, readCloudflareToken } from "./account.mjs";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("../../../", import.meta.url));

// Owns only the randomly named deployments recorded in this run's journal.
export async function prepareResources(accountId) {
  const token = await readCloudflareToken();
  const read = createAccountReader({ accountId, token });
  const account = await read("workers/subdomain");
  const subdomain = account.result?.subdomain;
  assert.ok(
    account.ok &&
      typeof subdomain === "string" &&
      /^[a-z0-9-]+$/.test(subdomain),
    "Workers subdomain unavailable",
  );
  const id = randomBytes(12).toString("hex");
  const base = resolve(root, ".wrangler/cloud-agent-infrastructure");
  await mkdir(base, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(`${base}/workspace-`);
  const reportFile = resolve(directory, "report.json");
  const report = {
    id,
    accountId,
    startedAt: new Date().toISOString(),
    resources: [],
    checks: [],
    cleanupVerified: false,
  };
  const save = () =>
    writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, {
      mode: 0o600,
    });
  const credentials = new Map();

  async function list(kind) {
    const results = [];
    let cursor = "",
      page = 1;
    do {
      const path =
        kind === "containers"
          ? `containers/applications?per_page=100${cursor ? `&page_token=${encodeURIComponent(cursor)}` : ""}`
          : `workers/durable_objects/namespaces?per_page=1000&page=${page}`;
      const response = await read(path);
      assert.ok(
        response.ok && Array.isArray(response.result),
        `Could not list ${kind}`,
      );
      results.push(...response.result);
      if (kind === "containers")
        cursor = response.resultInfo?.next_page_token || "";
      else
        cursor = page < (response.resultInfo?.total_pages ?? 1) ? "next" : "";
      page++;
      assert.ok(page <= 100, "Resource pagination exceeded proof limit");
    } while (cursor);
    return results;
  }

  async function prepare(kind, { entrypoint, bindings, loaderBinding } = {}) {
    const name = `restyle-${kind}-proof-${id}`;
    assert.equal(
      (await read(`workers/scripts/${name}/settings`)).status,
      404,
      "Disposable Worker name must be unused",
    );
    assert.equal(
      (await list("containers")).some((app) => app.name === name),
      false,
      "Disposable container name must be unused",
    );
    const proofToken = randomBytes(32).toString("hex");
    const resource = {
      kind,
      name,
      url: `https://${name}.${subdomain}.workers.dev`,
      config: resolve(directory, `${kind}.json`),
      secrets: resolve(directory, `${kind}-secrets.json`),
      attempted: false,
      removed: false,
    };
    const className = kind === "workspace" ? "Workspace" : "Release";
    const ownedBindings = bindings ?? [
      {
        name: kind === "workspace" ? "WORKSPACE" : "RELEASE",
        class_name: className,
      },
    ];
    const config = {
      name,
      account_id: accountId,
      main: resolve(
        root,
        entrypoint ??
          `scripts/checks/cloud-agent-infrastructure/${kind}-worker.js`,
      ),
      compatibility_date: "2026-10-03",
      workers_dev: true,
      preview_urls: false,
      observability: { enabled: false },
      vars: {
        PROOF_ID: id,
        PROOF_EXPIRES_AT: String(Date.now() + 20 * 60_000),
      },
      durable_objects: { bindings: ownedBindings },
      exports: Object.fromEntries(
        ownedBindings.map((binding) => [
          binding.class_name,
          {
            type: "durable-object",
            storage: "sqlite",
            ...(kind === "workspace" ? { container: name } : {}),
          },
        ]),
      ),
      ...(kind === "workspace"
        ? {
            containers: [
              {
                name,
                class_name: className,
                scheduling_policy: "durable_object",
              },
            ],
          }
        : { worker_loaders: [{ binding: loaderBinding ?? "LOADER" }] }),
    };
    await writeFile(resource.config, JSON.stringify(config, null, 2), {
      mode: 0o600,
    });
    await writeFile(
      resource.secrets,
      JSON.stringify({ PROOF_TOKEN: proofToken }),
      { mode: 0o600 },
    );
    credentials.set(name, proofToken);
    report.resources.push(resource);
    await save();
    return resource;
  }

  async function command(resource, dryRun) {
    const args = [
      resolve(root, "node_modules/wrangler/bin/wrangler.js"),
      "deploy",
      "--config",
      resource.config,
    ];
    args.push(
      ...(dryRun
        ? [
            "--dry-run",
            "--outdir",
            resolve(directory, `bundle-${resource.kind}`),
          ]
        : ["--secrets-file", resource.secrets]),
    );
    try {
      const result = await exec(process.execPath, args, {
        cwd: root,
        timeout: 120_000,
        maxBuffer: 1024 * 1024,
        env: {
          ...process.env,
          CLOUDFLARE_API_TOKEN: token,
          WRANGLER_SEND_METRICS: "false",
          CI: "true",
        },
      });
      return result;
    } catch (error) {
      let diagnostic = `${error.stdout ?? ""}\n${error.stderr ?? ""}`;
      for (const secret of [token, ...credentials.values()])
        diagnostic = diagnostic.replaceAll(secret, "[redacted]");
      await writeFile(
        resolve(directory, `${resource.kind}-deployment-error.log`),
        diagnostic,
        { mode: 0o600 },
      );
      throw new Error(
        `${resource.kind} ${dryRun ? "dry run" : "deployment"} failed; see private deployment diagnostic`,
      );
    }
  }

  async function deploy(resource) {
    await command(resource, true);
    resource.attempted = true;
    await save();
    console.log(`Deploying ${resource.name}`);
    await command(resource, false);
    await discover(resource);
    await save();
  }

  async function discover(resource) {
    const namespaces = (await list("namespaces")).filter(
      (ns) => ns.script === resource.name,
    );
    resource.namespaceIds = [
      ...new Set([
        ...(resource.namespaceIds ?? []),
        ...namespaces.map((ns) => ns.id),
      ]),
    ];
    const apps = (await list("containers")).filter(
      (app) => app.name === resource.name,
    );
    resource.applicationIds = [
      ...new Set([
        ...(resource.applicationIds ?? []),
        ...apps.map((app) => app.id),
      ]),
    ];
    await save();
    return apps;
  }

  async function call(
    resource,
    path,
    method = "GET",
    body,
    authenticated = true,
  ) {
    const response = await fetch(`${resource.url}${path}`, {
      method,
      headers: authenticated
        ? {
            Authorization: `Bearer ${credentials.get(resource.name)}`,
            "Content-Type": "application/json",
          }
        : {},
      ...(body === undefined
        ? {}
        : { body: typeof body === "string" ? body : JSON.stringify(body) }),
      redirect: "error",
      signal: AbortSignal.timeout(70_000),
    });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
    return {
      status: response.status,
      marker: response.headers.get("X-Restyle-Proof"),
      data,
    };
  }

  async function ready(resource) {
    for (let attempt = 0; attempt < 15; attempt++) {
      try {
        const response = await call(resource, "/health");
        if (response.status === 200 && response.marker === id) return;
      } catch {
        /* Only repeat a read-only propagation check. */
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error(`${resource.kind} URL did not become ready`);
  }

  async function deleteOwned(path) {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/${path}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      },
    );
    const body = await response.json();
    assert.ok(
      (response.ok && body.success === true) || response.status === 404,
      "Owned resource deletion failed",
    );
  }

  async function remove(resource) {
    if (!resource.attempted || resource.removed) return;
    console.log(`Removing ${resource.name}`);
    await discover(resource); // Reconcile an upload whose response was lost.
    try {
      resource.storageDeletion = await call(resource, "/", "DELETE");
    } catch {
      resource.storageDeletion = { unreachable: true };
    }
    for (const application of resource.applicationIds)
      await deleteOwned(
        `containers/applications/${encodeURIComponent(application)}`,
      );
    await deleteOwned(`workers/scripts/${resource.name}?force=true`);
    for (let attempt = 0; attempt < 10; attempt++) {
      const worker = await read(`workers/scripts/${resource.name}/settings`);
      const apps = await list("containers");
      const namespaces = await list("namespaces");
      if (
        worker.status === 404 &&
        !apps.some(
          (app) =>
            app.name === resource.name ||
            resource.applicationIds.includes(app.id),
        ) &&
        !namespaces.some(
          (ns) =>
            ns.script === resource.name ||
            resource.namespaceIds.includes(ns.id),
        )
      ) {
        resource.removed = true;
        resource.removedAt = new Date().toISOString();
        await save();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error(`${resource.kind} cleanup could not be verified`);
  }

  async function cleanup() {
    for (const resource of report.resources) {
      try {
        await remove(resource);
      } catch (error) {
        resource.cleanupFailure = error.message;
      }
    }
    report.cleanupVerified = report.resources.every(
      (resource) => !resource.attempted || resource.removed,
    );
    report.finishedAt = new Date().toISOString();
    await save();
    // Keep credentials only while unresolved cleanup may still need them.
    if (report.cleanupVerified)
      for (const resource of report.resources)
        await rm(resource.secrets, { force: true });
  }

  await save();
  return {
    id,
    directory,
    reportFile,
    report,
    save,
    prepare,
    deploy,
    ready,
    call,
    remove,
    cleanup,
  };
}
