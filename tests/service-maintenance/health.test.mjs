import test from "node:test";
import assert from "node:assert/strict";
import {
  hosted,
  control,
  publicCall,
  action,
  expectStatus,
  inspect,
} from "../service-actions/helpers.mjs";
import {
  fixture,
  connectInput,
  TOKEN,
} from "../account-connections/helpers.mjs";
import {
  connectedAgreement,
  connectedSource,
} from "../connected-services/fixtures.mjs";
import { taskFixture } from "../assistant-task-server/helpers.mjs";

test(
  "health is owner scoped, read only, sanitized and survives restart",
  { timeout: 25000 },
  async () => {
    const f = await taskFixture({ services: true });
    try {
      const s = await hosted(f);
      expectStatus(await control(f, s, "activate"), 200);
      expectStatus(
        await publicCall(
          f,
          s,
          action("completed-private-guest", "Private Guest"),
        ),
        200,
      );
      const before = await inspect(f, s);
      const url = `/api/services/${s.identity.serviceId}/maintenance`;
      const result = await f.request(url);
      expectStatus(result, 200);
      assert.equal(result.body.published.releaseId, s.identity.resourceId);
      assert.equal(result.body.releases.length, 1);
      assert.equal(result.body.issues.length, 0);
      assert.ok(!JSON.stringify(result.body).includes("Private Guest"));
      assert.ok(
        !JSON.stringify(result.body).includes("completed-private-guest"),
      );
      expectStatus(await f.request(url, { session: null }), 401);
      expectStatus(await f.request(url, { session: f.otherCookie }), 404);
      expectStatus(await f.request(url, { body: {} }), 405);
      assert.deepEqual(await inspect(f, s), before);
      await f.restart();
      expectStatus(await f.request(url), 200);
    } finally {
      await f.close();
    }
  },
);

test(
  "health distinguishes expiring and disconnected access without exposing provider credentials or account data",
  { timeout: 25000 },
  async () => {
    const f = await fixture({ services: true });
    try {
      expectStatus(await f.connection("connect", connectInput()), 200);
      const s = await hosted(f, {
        source: connectedSource().files[0].content,
        agreement: connectedAgreement(),
      });
      const url = `/api/services/${s.identity.serviceId}/maintenance`;
      let health = await f.request(url);
      expectStatus(health, 200);
      assert.ok(
        health.body.issues.some((i) => i.code === "connection_expiring"),
      );
      assert.ok(!JSON.stringify(health.body).includes(TOKEN));
      assert.ok(!JSON.stringify(health.body.connections).includes("octocat"));
      expectStatus(
        await f.connection("disconnect", {
          id: "connection-one",
          expectedRevision: 1,
        }),
        200,
      );
      health = await f.request(url);
      expectStatus(health, 200);
      assert.ok(
        health.body.issues.some(
          (i) =>
            i.stage === "external_account" && i.code === "connection_expired",
        ),
      );
    } finally {
      await f.close();
    }
  },
);

test(
  "missing published versions and capacity faults remain visible after restarts with truthful recovery",
  { timeout: 25000 },
  async () => {
    const f = await taskFixture({ services: true });
    try {
      const s = await hosted(f);
      expectStatus(await control(f, s, "activate"), 200);
      const base = `/api/services/${s.identity.serviceId}`;
      const report = {
        kind: "export",
        referenceId: "export-known",
        projectId: s.identity.projectId,
        title: "Known export",
        expectedRevision: 0,
        components: [
          {
            sceneId: "scene",
            sceneName: "Scene",
            componentId: "component",
            componentName: "Form",
            releaseId: s.identity.resourceId,
            operation: "join",
          },
        ],
      };
      expectStatus(
        await f.request(base + "/connections", { body: report }),
        200,
      );
      expectStatus(
        await f.request(base + "/publication", {
          body: { exportId: "export-known", publicationId: "not-owned" },
        }),
        404,
      );
      expectStatus(
        await f.control({
          action: "host-diagnostic",
          identity: s.identity,
          kind: "exhaust-calls",
        }),
        200,
      );
      let health = await f.request(base + "/maintenance");
      expectStatus(health, 200);
      assert.ok(health.body.issues.some((i) => i.code === "daily_limit"));
      await inspect(f, s, "drop-live-release");
      await f.restart();
      health = await f.request(base + "/maintenance");
      expectStatus(health, 200);
      assert.ok(health.body.issues.some((i) => i.key === "live-release"));
      assert.ok(
        health.body.issues.some(
          (i) => i.key === `release:${s.identity.resourceId}`,
        ),
      );
      assert.match(
        health.body.issues.find((i) => i.code === "missing_release").recovery,
        /Pause/,
      );
      expectStatus(
        await publicCall(f, s, action("blocked-after-missing")),
        404,
      );
    } finally {
      await f.close();
    }
  },
);
