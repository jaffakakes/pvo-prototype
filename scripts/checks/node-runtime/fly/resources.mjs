import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { requireFly } from "./api.mjs";
import {
  FLY_PROOF,
  flyMachineConfiguration,
  flyNetworkPolicy,
} from "./config.mjs";

/** Diagnostic ownership only. A saved journal may be resumed for cleanup, never another creation. */
export async function flyProofResources(
  request,
  org,
  {
    resumeReport = null,
    directoryRoot = resolve(".wrangler/fly-node-proof"),
    plan = FLY_PROOF,
  } = {},
) {
  assert.match(org, /^[a-z0-9][a-z0-9-]{0,62}$/);
  const base = resolve(directoryRoot);
  await mkdir(base, { recursive: true, mode: 0o700 });
  const directory = resumeReport
    ? dirname(resolve(resumeReport))
    : await mkdtemp(`${base}/run-`);
  assert.ok(directory.startsWith(base + sep));
  const reportFile = resolve(directory, "report.json");
  if (resumeReport) assert.equal(resolve(resumeReport), reportFile);
  const report = resumeReport
    ? JSON.parse(await readFile(reportFile, "utf8"))
    : {
        id: randomBytes(12).toString("hex"),
        org,
        startedAt: Date.now(),
        attempted: false,
        cleanupVerified: false,
        machines: [],
        checks: [],
        plan: { ...plan, approved: false },
      };
  assert.match(report.id, /^[a-f0-9]{24}$/);
  assert.equal(report.org, org);
  const app = `restyle-node-proof-${report.id}`;
  if (resumeReport) assert.equal(report.app, app);
  report.app = app;
  const path = `/apps/${app}`;
  const save = async () => {
    const next = `${reportFile}.next`;
    await writeFile(next, JSON.stringify(report, null, 2) + "\n", {
      mode: 0o600,
    });
    await rename(next, reportFile);
  };
  await save();
  const requireActive = () => {
    assert.equal(
      resumeReport,
      null,
      "Cleanup-only recovery cannot create resources",
    );
    assert.equal(report.plan.approved, true, "Proof is not approved");
    assert.ok(
      Date.now() < report.startedAt + report.plan.lifetimeMs - 60000,
      "Fly proof deadline reached",
    );
  };
  const inventory = async () => {
    const values = await requireFly(request, "GET", `${path}/machines`);
    assert.ok(Array.isArray(values));
    for (const value of values) {
      assert.equal(
        value.config?.metadata?.restyle_proof,
        report.id,
        "Unexpected Machine in owned proof app; preserve it",
      );
      assert.match(value.id, /^[a-f0-9]{10,32}$/);
    }
    return values;
  };
  const removeMachine = async (machine) => {
    assert.equal(
      machine.config?.metadata?.restyle_proof,
      report.id,
      "Refuse destruction without matching ownership",
    );
    assert.match(machine.id, /^[a-f0-9]{10,32}$/);
    const target = `${path}/machines/${machine.id}`;
    const before = await request("GET", target);
    if (before.status !== 404) {
      assert.ok(before.ok, "Machine ownership inspection failed");
      assert.equal(
        before.data?.config?.metadata?.restyle_proof,
        report.id,
        "Machine ownership changed; preserve it",
      );
      if (before.data.state !== "destroyed") {
        const deleted = await request("DELETE", `${target}?force=true`);
        assert.ok(
          deleted.ok || deleted.status === 404,
          `Machine deletion failed (${deleted.status})`,
        );
      }
    }
    const absent = await request("GET", target);
    assert.ok(
      absent.status === 404 ||
        (absent.ok && absent.data?.state === "destroyed"),
      "Machine destruction not confirmed",
    );
    const row = report.machines.find((value) => value.name === machine.name);
    if (row) {
      row.removed = true;
      row.removedAt = Date.now();
    }
    await save();
  };
  return {
    report,
    reportFile,
    save,
    request,
    path,
    inventory,
    removeMachine,
    async createApp() {
      requireActive();
      assert.equal(
        (await request("GET", path)).status,
        404,
        "Fly proof app name must be unused",
      );
      report.attempted = true;
      await save();
      const created = await request("POST", "/apps", {
        app_name: app,
        org_slug: org,
        network: app,
      });
      if (!created.ok && created.status >= 400 && created.status < 500) {
        report.attempted = false;
        report.creationRejected = created.status;
        report.creationBlocker =
          typeof created.data?.error === "string" &&
          /overdue invoices/i.test(created.data.error)
            ? "billing_past_due"
            : "provider_rejected";
        await save();
      }
      assert.ok(
        created.ok,
        report.creationBlocker === "billing_past_due"
          ? "Fly account payment is past due; resolve billing before creating the test app."
          : `Fly app creation failed (${created.status})`,
      );
      const actual = await requireFly(request, "GET", path);
      assert.equal(actual.name, app);
      assert.equal(
        actual.organization?.slug,
        org,
        "Fly app belongs to a different organisation",
      );
      report.appVerified = true;
      await save();
    },
    async restrictNetwork() {
      requireActive();
      assert.equal(
        (await inventory()).filter((value) => value.state !== "destroyed")
          .length,
        0,
        "Policy must be installed before new Machines start",
      );
      report.policyAttempted = true;
      await save();
      const policy = await requireFly(
        request,
        "POST",
        `${path}/network_policies`,
        flyNetworkPolicy(),
      );
      report.policy = policy;
      await save();
      // A successful configuration request is not proof that empty port lists block packets.
    },
    async createMachine(files, configure = flyMachineConfiguration) {
      requireActive();
      assert.ok(
        report.machines.length < report.plan.maxMachines,
        "Fly diagnostic start allowance reached",
      );
      assert.equal(
        (await inventory()).filter((value) => value.state !== "destroyed")
          .length,
        0,
        "An earlier Machine still requires cleanup",
      );
      const name = `restyle-${report.id}-${String(report.machines.length).padStart(2, "0")}`;
      const configuration = configure({ name, proofId: report.id, files });
      assert.equal(configuration.name, name);
      assert.equal(configuration.config.metadata.restyle_proof, report.id);
      const row = {
        name,
        attemptedAt: Date.now(),
        id: null,
        removed: false,
        image: configuration.config.image,
        guest: configuration.config.guest,
      };
      report.machines.push(row);
      await save();
      // No retry after an uncertain create. Cleanup discovers the saved name/metadata in this app.
      const actual = await requireFly(
        request,
        "POST",
        `${path}/machines`,
        configuration,
        { timeoutMs: 45000 },
      );
      assert.match(actual.id, /^[a-f0-9]{10,32}$/);
      assert.equal(actual.config?.metadata?.restyle_proof, report.id);
      row.id = actual.id;
      row.createdAt = Date.now();
      await save();
      return { ...actual, name };
    },
    async cleanup() {
      if (report.attempted) {
        const found = await request("GET", path);
        if (found.status !== 404) {
          assert.ok(
            found.ok,
            "Fly app inspection failed; cleanup remains pending",
          );
          assert.equal(found.data?.name, app);
          assert.equal(
            found.data?.organization?.slug,
            org,
            "Fly app ownership changed; preserve it",
          );
          for (const machine of await inventory()) await removeMachine(machine);
          assert.equal(
            (await inventory()).filter((value) => value.state !== "destroyed")
              .length,
            0,
          );
          const deleted = await request("DELETE", path);
          assert.ok(
            deleted.ok || deleted.status === 404,
            `Fly app deletion failed (${deleted.status})`,
          );
          assert.equal(
            (await request("GET", path)).status,
            404,
            "Fly app deletion not confirmed",
          );
        }
      }
      report.cleanupVerified = true;
      report.finishedAt = Date.now();
      await save();
    },
  };
}
