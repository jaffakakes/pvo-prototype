import assert from "node:assert/strict";
import test from "node:test";
import { api, setup } from "./helpers.mjs";

async function fixture() {
  const f = await setup();
  const report = api.projectConnectionReport(
    f.snapshot,
    f.scope.assistantTaskLinks,
    f.scope.localId,
    f.scope.ownerId,
    "Dinner",
  );
  const records = [],
    sent = [],
    order = [];
  let current = true;
  const adapters = {
    flush: async () => {
      order.push("saved locally");
    },
    list: async () => {
      order.push("listed");
      return [
        { metadata: { identity: f.summary.service.identity, state: "active" } },
      ];
    },
    read: async () => ({
      service: f.summary.service,
      records: structuredClone(records),
    }),
    send: async (owner, id, value) => {
      order.push("reported");
      sent.push(structuredClone(value));
      records.splice(0, records.length, {
        report: value,
        revision: records.length ? records[0].revision + 1 : 1,
        recordedAt: 1,
        publications: [],
      });
    },
  };
  const context = {
    signal: new AbortController().signal,
    isCurrent: () => current,
  };
  return {
    f,
    report,
    sent,
    records,
    order,
    adapters,
    context,
    invalidate() {
      current = false;
    },
    run() {
      return api.syncProjectConnections(report, adapters, context);
    },
  };
}

test("project dependency metadata is private, saved before reporting, replayed quietly and cleared after local removal", async () => {
  const f = await fixture();
  assert(!JSON.stringify(f.report).includes("receipt"));
  assert(!JSON.stringify(f.report).includes("input"));
  assert(!JSON.stringify(f.report).includes("source"));
  await f.run();
  assert.deepEqual(f.order, ["saved locally", "listed", "reported"]);
  await f.run();
  assert.equal(f.sent.length, 1);
  f.report.services = [];
  await f.run();
  assert.equal(f.sent.length, 2);
  assert.equal(f.sent[1].expectedRevision, 1);
  assert.deepEqual(f.sent[1].components, []);
  assert.equal(
    api.projectConnectionReport(
      f.f.snapshot,
      f.f.scope.assistantTaskLinks,
      "copied-project",
      f.f.scope.ownerId,
      "Copy",
    ),
    null,
  );
  assert.equal(
    api.projectConnectionReport(
      f.f.snapshot,
      f.f.scope.assistantTaskLinks,
      f.f.scope.localId,
      "other-owner",
      "Foreign",
    ),
    null,
  );
});

test("connection reporting preserves old records on save failure, account/project replacement or uncertain replies", async () => {
  for (const stage of ["flush", "list", "read"]) {
    const f = await fixture(),
      original = f.adapters[stage];
    f.adapters[stage] = async (...args) => {
      const value = await original(...args);
      f.invalidate();
      return value;
    };
    await assert.rejects(f.run(), { name: "AbortError" });
    assert.equal(f.sent.length, 0);
  }
  const f = await fixture();
  f.adapters.flush = async () => {
    throw new Error("local disk full");
  };
  await assert.rejects(f.run(), /local disk full/);
  assert.equal(f.sent.length, 0);
  f.adapters.flush = async () => {};
  const original = f.adapters.send;
  f.adapters.send = async (...args) => {
    await original(...args);
    throw new Error("reply lost");
  };
  await assert.rejects(f.run(), /reply lost/);
  f.adapters.send = original;
  await f.run();
  assert.equal(
    f.sent.length,
    1,
    "Fresh read recovers a committed report without another write",
  );
});
