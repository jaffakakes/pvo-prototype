import assert from "node:assert/strict";
import test from "node:test";
import {
  taskFixture,
  expectStatus,
  hosted,
  version,
  control,
  action,
  call,
  publicCall,
  inspect,
} from "./helpers.mjs";

const exactTry = (f, service, body) =>
  f.request(
    `/api/services/${service.identity.serviceId}/releases/${service.identity.resourceId}/try`,
    { body },
  );

for (const lifecycle of ["active", "paused"]) {
  test(
    `maintenance after restart removes abandoned test records while preserving ${lifecycle} code, draft, exports and accepted replies`,
    { timeout: 30000 },
    async () => {
      const f = await taskFixture({ services: true });
      try {
        const live = await hosted(f);
        expectStatus(await control(f, live, "activate"), 200);
        const accepted = await publicCall(f, live, action("accepted-live"));
        expectStatus(accepted, 200);
        const retainedTest = await call(
          f,
          live,
          action("accepted-retained-test"),
        );
        expectStatus(retainedTest, 200);
        const path = `/api/services/${live.identity.serviceId}/connections`;
        expectStatus(
          await f.request(path, {
            body: {
              kind: "export",
              referenceId: "retained-export",
              projectId: live.identity.projectId,
              title: "Dinner",
              expectedRevision: 0,
              components: [
                {
                  sceneId: "scene",
                  sceneName: "Scene",
                  componentId: "form",
                  componentName: "Join",
                  releaseId: live.identity.resourceId,
                  operation: "join",
                },
              ],
            },
          }),
          200,
        );
        const abandoned = await version(f, live);
        expectStatus(
          await exactTry(f, abandoned, action("abandoned-test")),
          200,
        );
        expectStatus(
          await call(f, abandoned, {
            ...action("failed-test"),
            input: { unexpected: true },
          }),
          400,
        );
        if (lifecycle === "paused")
          expectStatus(await control(f, live, "pause"), 200);
        const before = await inspect(f, live);
        const retained = await inspect(f, live, "maintenance");
        assert(
          retained.failures.some(
            (r) => r.namespace === `test:${abandoned.identity.resourceId}`,
          ),
        );
        assert.equal(retained.alarm, abandoned.identity.expiresAt);
        const writer = await inspect(f, live, "stop-draft-writer");
        assert.equal(writer.writers.length, 1);
        assert(
          writer.alarm < retained.alarm,
          "writer expiry is scheduled even while release lives longer",
        );
        await f.restart();
        await f.control({ action: "time", now: writer.alarm });
        const firstSweep = await inspect(f, live, "sweep");
        assert.deepEqual(firstSweep.writers, []);
        assert.equal(firstSweep.alarm, retained.alarm);
        assert(firstSweep.releases.every((r) => r.body !== null));
        await f.restart();
        await f.control({ action: "time", now: retained.alarm + 1 });
        const swept = await inspect(f, live, "sweep");
        assert.equal(swept.alarm, null);
        assert.equal(
          swept.releases.find((r) => r.id === abandoned.identity.resourceId)
            .body,
          null,
        );
        assert(
          swept.releases.find((r) => r.id === live.identity.resourceId).body,
        );
        assert.deepEqual(swept.draft, retained.draft);
        assert.deepEqual(swept.connections, retained.connections);
        assert.deepEqual(swept.failures, []);
        const after = await inspect(f, live);
        assert.equal(after.service.state, lifecycle);
        for (const key of ["data", "receipts", "usage"])
          assert.deepEqual(
            after[key],
            before[key].filter(
              (r) => r.namespace !== `test:${abandoned.identity.resourceId}`,
            ),
          );
        if (lifecycle === "paused")
          expectStatus(await control(f, live, "activate"), 200);
        assert.deepEqual(
          (await publicCall(f, live, action("accepted-live"))).body,
          accepted.body,
        );
        assert.deepEqual(
          (await exactTry(f, live, action("accepted-retained-test"))).body,
          retainedTest.body,
        );
        expectStatus(
          await exactTry(f, abandoned, action("abandoned-test")),
          404,
        );
        expectStatus(await control(f, live, "delete"), 200);
        await inspect(f, live, "sweep");
        const deleted = await inspect(f, live, "maintenance");
        assert.equal(deleted.draft, null);
        assert.deepEqual(deleted.connections, []);
        assert(deleted.releases.every((r) => r.body === null));
      } finally {
        await f.close();
      }
    },
  );
}
