import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { prepareResources } from "../cloud-agent-infrastructure/proof-resources.mjs";

export const productBindings = [
  { name: "ASSISTANT_TASKS", class_name: "ProductTasks" },
  { name: "SERVICE_HOSTS", class_name: "ProductHost" },
  { name: "SERVICE_NODE_EXECUTION", class_name: "ProductNode" },
  { name: "PROOF_CONTROL", class_name: "ProductControl" },
];

export async function productWorker(
  accountId,
  fly,
  {
    token,
    image,
    cleanup = false,
    dryRun = false,
    entrypoint = "scripts/checks/node-product/worker.js",
    secrets = {},
  } = {},
) {
  const { report, save } = fly;
  const resources = await prepareResources(accountId, {
    resumeReport: cleanup ? report.cloudJournal : null,
  });
  let resource;
  if (cleanup) resource = resources.report.resources[0];
  else {
    report.cloudJournal = resources.reportFile;
    await save();
    resource = await resources.prepare("node-product", {
      entrypoint,
      bindings: productBindings,
      loaderBinding: false,
      expiresAt: report.startedAt + report.plan.lifetimeMs,
      vars: { SERVICE_NODE_FLY_APP: report.app, SERVICE_NODE_FLY_IMAGE: image },
      secrets: { ...secrets, SERVICE_NODE_FLY_TOKEN: token },
    });
    const config = JSON.parse(await readFile(resource.config, "utf8"));
    config.vars.PUBLIC_ORIGIN = resource.url;
    await writeFile(resource.config, JSON.stringify(config, null, 2), {
      mode: 0o600,
    });
    if (dryRun) await resources.dryRun(resource);
    else {
      await resources.deploy(resource);
      await resources.ready(resource);
    }
  }
  let operator;
  try {
    operator = resource
      ? JSON.parse(await readFile(resource.secrets, "utf8")).PROOF_TOKEN
      : null;
  } catch {
    if (resource && !resource.removed && resource.attempted)
      throw new Error(
        "Diagnostic credential required for safe compute cleanup",
      );
  }
  const call = async (path, method = "GET", body, authenticated = true) => {
    assert(resource, "No diagnostic Worker was prepared");
    const response = await fetch(resource.url + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(authenticated ? { Authorization: `Bearer ${operator}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "error",
      signal: AbortSignal.timeout(315000),
    });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text.slice(0, 300) };
    }
    return { status: response.status, data };
  };
  return {
    call,
    resource,
    resources,
    async cleanup() {
      if (resource?.attempted && !resource.removed) {
        let closed = false;
        for (let attempt = 0; attempt < 20; attempt++) {
          const reply = await call("/", "DELETE");
          report.computeCleanup = reply;
          await save();
          if (
            reply.status === 200 &&
            reply.data.slots.length === 2 &&
            reply.data.slots.every((slot) => slot.lease === null)
          ) {
            closed = true;
            break;
          }
          await delay(1000);
        }
        assert(
          closed,
          "Keep the Worker and leases until owned Fly compute is confirmed absent",
        );
        const inventory = await fly.request("GET", `${fly.path}/machines`);
        assert(inventory.ok && Array.isArray(inventory.data));
        assert(
          inventory.data.every((machine) => machine.state === "destroyed"),
          "Preserve unresolved Fly instances and their durable ownership records",
        );
      }
      await resources.cleanup();
      assert(
        resources.report.cleanupVerified,
        "Cloudflare cleanup remains unresolved",
      );
      report.cloudCleanupVerified = true;
      await save();
    },
  };
}
