import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  taskFixture,
  hosted,
  version,
  control,
  expectStatus,
  inspect,
  publicCall,
  action,
} from "../service-actions/helpers.mjs";
import { dinnerAgreement } from "../service-validation/fixtures.mjs";
import { until } from "../service-drafts/task.helpers.mjs";
import { path } from "../assistant-task-server/helpers.mjs";
import { draftContent, repairDecision } from "./helpers.mjs";
import { selectedTestRunner } from "./workshop.mjs";

test(
  "repair preserves live records and replies through checked publication, restart and rollback",
  { timeout: 25000 },
  async () => {
    const f = await taskFixture({
      services: true,
      workspaces: true,
      planner: repairDecision,
      workspaceEffects: selectedTestRunner(),
    });
    try {
      expectStatus(await f.control({ action: "pause-planning" }), 200);
      const s = await hosted(f);
      expectStatus(await control(f, s, "activate"), 200);
      expectStatus(
        await publicCall(f, s, action("original-viewer", "Existing")),
        200,
      );
      const base = `/api/services/${s.identity.serviceId}`;
      const draft = (await f.request(base + "/draft")).body;
      expectStatus(
        await f.request(base + "/draft", {
          body: {
            actionId: randomUUID(),
            expectedRevision: draft.revision,
            content: { ...draft.content, ...draftContent(true) },
          },
        }),
        200,
      );
      const original = await inspect(f, s);
      const created = await f.create(s.identity.projectId, {
        operationId: randomUUID(),
        request: "Repair the capacity bug without losing accepted records",
        examples: [],
        context: {
          fingerprint: "repair-existing",
          container: {
            serviceId: s.identity.serviceId,
            revision: 1,
            mode: "repair",
          },
        },
      });
      expectStatus(created, 201);
      expectStatus(await f.control({ action: "resume-planning" }), 200);
      const done = await until(f, created.body.task, (t) =>
        ["ready", "failed"].includes(t.state),
      );
      assert.equal(done.state, "ready", JSON.stringify(done));
      assert.deepEqual(
        (await inspect(f, s)).data.filter((row) => row.namespace === "live"),
        original.data.filter((row) => row.namespace === "live"),
      );
      const summary = (await f.request(base)).body.summary;
      const repaired = {
        ...s,
        identity: { ...s.identity, resourceId: summary.service.testReleaseId },
      };
      expectStatus(await control(f, repaired, "activate"), 200);
      await f.restart();
      assert.equal(
        (await publicCall(f, s, action("original-viewer", "Existing"))).body
          .result,
        "accepted",
      );
      expectStatus(await control(f, s, "activate"), 200);
      assert.equal(
        (await publicCall(f, s, action("original-viewer", "Existing"))).body
          .result,
        "accepted",
      );
      const final = await inspect(f, s);
      assert.equal(
        final.receipts.filter((row) => row.namespace === "live").length,
        1,
      );
      assert.deepEqual(
        JSON.parse(final.data.find((row) => row.namespace === "live").body)
          .guests,
        ["Existing"],
      );
      assert.equal(
        (await f.request(path(done) + "/tests")).body.repair.regression,
        "reproduced",
      );
    } finally {
      await f.close();
    }
  },
);

test(
  "background work blocks update until resolved; update and rollback cannot repeat a completed viewer action",
  { timeout: 25000 },
  async () => {
    let executions = 0;
    const f = await taskFixture({
      services: true,
      hostControl: async () => {
        executions++;
        return Response.json({});
      },
    });
    try {
      const agreement = dinnerAgreement();
      agreement.operations[0].delivery = "background";
      const s = await hosted(f, { agreement });
      expectStatus(await control(f, s, "activate"), 200);
      const base = `/api/services/${s.identity.serviceId}`;
      const input = {
        releaseId: s.identity.resourceId,
        action: action("background-original", "Existing"),
        receiptKey: "a".repeat(64),
        schedule: null,
      };
      expectStatus(
        await f.request(base + "/jobs", { session: null, body: input }),
        202,
      );
      const next = await version(f, s, { agreement });
      expectStatus(await control(f, next, "activate"), 409);
      expectStatus(
        await f.control({
          action: "host-diagnostic",
          identity: s.identity,
          kind: "sweep",
        }),
        200,
      );
      assert.equal(executions, 1);
      expectStatus(await control(f, next, "activate"), 200);
      await f.restart();
      expectStatus(await control(f, s, "activate"), 200);
      const replay = await f.request(base + "/jobs", {
        session: null,
        body: input,
      });
      expectStatus(replay, 202);
      assert.equal(replay.body.job.status, "confirmed");
      assert.equal(executions, 1);
      assert.equal((await inspect(f, s)).receipts.length, 1);
    } finally {
      await f.close();
    }
  },
);
