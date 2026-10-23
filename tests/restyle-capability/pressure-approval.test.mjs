import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile } from "node:fs/promises";
import {
  taskFixture,
  hosted,
  expectStatus,
  status,
} from "../service-actions/helpers.mjs";
import { controlledEmail } from "../../scripts/checks/restyle-capability/durable-email.mjs";
import { approvePressureEmail } from "../../scripts/checks/restyle-capability/pressure-browser.mjs";

test(
  "pressure approval uses the receipt service identity and activates the unchanged checked email package",
  {
    skip: !process.env.RESTYLE_PRESSURE_APPROVAL_SOURCE,
    timeout: 30000,
  },
  async () => {
    const original = JSON.parse(
      await readFile(process.env.RESTYLE_PRESSURE_APPROVAL_SOURCE, "utf8"),
    );
    const attachment = original.preparedResult.attachment;
    const checked = original["validation-state"].artifacts.find(
      (row) =>
        row.artifact.identity.packageDigest ===
        attachment.receipt.identity.packageDigest,
    );
    assert.equal(checked.report.status, "passed");
    const journal = {
      kind: "local-worker",
      name: "pressure-approval-calibration",
      cleaned: false,
      originalJournal: process.env.RESTYLE_PRESSURE_APPROVAL_SOURCE,
    };
    const save = () =>
      writeFile(
        process.env.RESTYLE_PRESSURE_APPROVAL_JOURNAL,
        JSON.stringify(journal, null, 2),
        { mode: 0o600 },
      );
    await save();
    const email = controlledEmail();
    const fixture = await taskFixture({
      services: true,
      connectionKey: "a".repeat(64),
      connectionFetch: email.connectionFetch,
    });
    journal.storagePath = fixture.storagePath;
    await save();
    try {
      await email.seed(fixture);
      const service = await hosted(fixture, {
        checked: { artifact: checked.artifact, report: checked.report },
      });
      const saved = {
        receipt: { ...attachment.receipt, identity: service.identity },
        connection: {
          ...attachment.command.connection,
          releaseId: service.identity.resourceId,
        },
      };
      assert.equal(saved.connection.serviceId, undefined);
      expectStatus(
        await fixture.request(
          `/api/services/${saved.connection.serviceId}/account-access`,
          { body: { kind: "approve", releaseId: saved.connection.releaseId } },
        ),
        404,
      );
      await approvePressureEmail(fixture, saved, async (kind, data) => {
        journal.approval = { kind, ...data };
        await save();
      });
      expectStatus(await status(fixture, service), 200);
      assert.equal(email.calls.length, 0);
      journal.unchangedPackageDigest = checked.artifact.identity.packageDigest;
      journal.status = "passed";
    } finally {
      await fixture.close();
      journal.cleaned = true;
      await save();
    }
  },
);
