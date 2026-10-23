import assert from "node:assert/strict";
import test from "node:test";
import {
  taskFixture,
  expectStatus,
  hosted,
  version,
  control,
  status,
  inspect,
  publicCall,
  deferred,
} from "./helpers.mjs";
import {
  counterAgreement,
  counterSource,
  increment,
} from "./update-fixtures.mjs";
import { prepareReleaseActivation } from "../../packages/pvo-assistant/hosting/index.js";
import { dinnerAgreement } from "../service-validation/fixtures.mjs";
const options = { timeout: 25000 };

test("compatibility compares operation meaning while ignoring descriptive wording and field order", () => {
  const before = dinnerAgreement(),
    after = structuredClone(before);
  after.description = "Reworded";
  after.operations.reverse();
  for (const operation of after.operations) {
    operation.description = "Another description";
    if (operation.input.type === "object") operation.input.fields.reverse();
  }
  assert.deepEqual(
    prepareReleaseActivation(before, after, before.state.initial),
    before.state.initial,
  );
  for (const key of ["audience", "access", "input", "result", "name"]) {
    const bad = counterAgreement();
    if (key === "audience") bad.operations[0].audience = "creator";
    if (key === "access") bad.operations[0].access = "read";
    if (key === "input") {
      bad.operations[0].input = { type: "boolean" };
      bad.cases[0].steps[0].input = true;
    }
    if (key === "result") bad.operations[0].result.maximum = 99;
    if (key === "name") {
      bad.operations[0].name = "another";
      bad.cases[0].steps[0].operation = "another";
    }
    assert.throws(() => prepareReleaseActivation(counterAgreement(), bad, 0), {
      code: "incompatible_version",
    });
  }
  assert.throws(
    () =>
      prepareReleaseActivation(counterAgreement(10), counterAgreement(1), 2),
    { code: "incompatible_version" },
  );
});

test(
  "a checked update and rollback retain current live records, saved replies, prior code and exact control results across restart",
  options,
  async () => {
    const f = await taskFixture({ services: true });
    try {
      const one = await hosted(f, {
        source: counterSource(),
        agreement: counterAgreement(10),
      });
      expectStatus(await control(f, one, "activate"), 200);
      assert.equal(
        (await publicCall(f, one, increment("first"))).body.result,
        1,
      );
      const two = await version(f, one, {
        source: counterSource(2),
        agreement: counterAgreement(10, 2),
      });
      assert.equal(
        (await status(f, one)).body.summary.service.liveReleaseId,
        one.identity.resourceId,
        "Publishing a candidate does not replace the active version",
      );
      const state = await status(f, one),
        command = {
          kind: "activate",
          actionId: "switch",
          expectedRevision: state.body.summary.service.revision,
          releaseId: two.identity.resourceId,
        };
      const path = `/api/services/${one.identity.serviceId}/activate`;
      const switched = await f.request(path, { body: command });
      expectStatus(switched, 200);
      assert.equal(
        (await publicCall(f, one, increment("second"))).body.result,
        3,
      );
      const before = await inspect(f, one);
      expectStatus(await control(f, one, "activate"), 200);
      assert.deepEqual(
        (await inspect(f, one)).data,
        before.data,
        "Rollback must not rewind the records",
      );
      assert.deepEqual((await inspect(f, one)).receipts, before.receipts);
      assert.equal(
        (await publicCall(f, one, increment("first"))).body.result,
        1,
      );
      assert.equal(
        (await publicCall(f, one, increment("third"))).body.result,
        4,
      );
      await f.restart();
      const replay = await f.request(path, { body: command });
      expectStatus(replay, 200);
      assert.deepEqual(replay.body.receipt, switched.body.receipt);
      assert.equal(
        replay.body.summary.service.liveReleaseId,
        one.identity.resourceId,
      );
      assert(
        replay.body.summary.releases.every((row) => row.state === "retained"),
      );
      assert.equal(
        (await publicCall(f, one, increment("second"))).body.result,
        3,
      );
    } finally {
      await f.close();
    }
  },
);

test(
  "unsafe rollback, incompatible client operations and a missing release leave the working version and records unchanged",
  options,
  async () => {
    const f = await taskFixture({ services: true });
    try {
      const one = await hosted(f, {
        source: counterSource(),
        agreement: counterAgreement(1),
      });
      expectStatus(await control(f, one, "activate"), 200);
      assert.equal(
        (await publicCall(f, one, increment("first"))).body.result,
        1,
      );
      const two = await version(f, one, {
        source: counterSource(),
        agreement: counterAgreement(10),
      });
      expectStatus(await control(f, two, "activate"), 200);
      assert.equal(
        (await publicCall(f, two, increment("second"))).body.result,
        2,
      );
      const changed = counterAgreement(10);
      changed.operations[0].audience = "creator";
      const three = await version(f, one, {
        source: counterSource(),
        agreement: changed,
      });
      const prior = await inspect(f, one);
      expectStatus(await control(f, one, "activate"), 422);
      expectStatus(await control(f, three, "activate"), 422);
      expectStatus(
        await control(f, one, "activate", { body: { releaseId: "unknown" } }),
        404,
      );
      const after = await inspect(f, one);
      assert.deepEqual(
        after,
        prior,
        "A rejected update must not change state, selected version, receipts or control history",
      );
      assert.equal(
        (await status(f, one)).body.summary.service.liveReleaseId,
        two.identity.resourceId,
      );
      assert.equal(
        (await publicCall(f, one, increment("third"))).body.result,
        3,
      );
    } finally {
      await f.close();
    }
  },
);

test(
  "replacement preserves initial live records even before any action was submitted",
  options,
  async () => {
    const f = await taskFixture({ services: true });
    try {
      const one = await hosted(f, {
        source: counterSource(),
        agreement: counterAgreement(10, 1, 2),
      });
      expectStatus(await control(f, one, "activate"), 200);
      const two = await version(f, one, {
        source: counterSource(),
        agreement: counterAgreement(10, 1, 0),
      });
      expectStatus(await control(f, two, "activate"), 200);
      assert.equal(
        (await publicCall(f, two, increment("first"))).body.result,
        3,
        "The replacement initial value must not reset existing live data",
      );
    } finally {
      await f.close();
    }
  },
);

test(
  "switching code fences a delayed execution and the unchanged action ID can then run once on the new version",
  options,
  async () => {
    const entered = deferred(),
      release = deferred();
    let first = true;
    const f = await taskFixture({
      services: true,
      hostControl: async () => {
        if (first) {
          first = false;
          entered.resolve();
          await release.promise;
        }
        return Response.json({});
      },
    });
    try {
      const one = await hosted(f, {
        source: counterSource(),
        agreement: counterAgreement(10),
      });
      expectStatus(await control(f, one, "activate"), 200);
      const two = await version(f, one, {
        source: counterSource(2),
        agreement: counterAgreement(10, 2),
      });
      const pending = publicCall(f, one, increment("in-flight"));
      await entered.promise;
      expectStatus(await control(f, two, "activate"), 200);
      release.resolve();
      assert.notEqual((await pending).status, 200);
      const before = await inspect(f, one);
      assert.equal(before.receipts.length, 0);
      assert.deepEqual(
        before.data.map((row) => JSON.parse(row.body)),
        [0],
      );
      assert.equal(
        (await publicCall(f, one, increment("in-flight"))).body.result,
        2,
      );
      assert.equal((await inspect(f, one)).receipts.length, 1);
    } finally {
      release.resolve();
      await f.close();
    }
  },
);

test(
  "an expired inactive candidate cannot replace the retained active program",
  options,
  async () => {
    const f = await taskFixture({ services: true });
    try {
      const one = await hosted(f, {
        source: counterSource(),
        agreement: counterAgreement(10),
      });
      expectStatus(await control(f, one, "activate"), 200);
      const two = await version(f, one, {
        source: counterSource(2),
        agreement: counterAgreement(10, 2),
      });
      await f.control({ action: "time", now: one.identity.expiresAt + 1 });
      await inspect(f, one);
      expectStatus(await control(f, two, "activate"), 404);
      assert.equal(
        (await status(f, one)).body.summary.service.liveReleaseId,
        one.identity.resourceId,
      );
      assert.equal(
        (await publicCall(f, one, increment("still-working"))).body.result,
        1,
      );
    } finally {
      await f.close();
    }
  },
);
