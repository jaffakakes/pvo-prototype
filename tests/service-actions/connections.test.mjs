import assert from "node:assert/strict";
import test from "node:test";
import {
  taskFixture,
  expectStatus,
  hosted,
  control,
  version,
  publicCall,
  action,
} from "./helpers.mjs";

const report = (service, overrides = {}) => ({
  kind: "project",
  referenceId: service.identity.projectId,
  projectId: service.identity.projectId,
  title: "Dinner project",
  expectedRevision: 0,
  components: [
    {
      sceneId: "scene-one",
      sceneName: "Dinner scene",
      componentName: "Join dinner",
      componentId: "form-one",
      releaseId: service.identity.resourceId,
      operation: "join",
    },
  ],
  ...overrides,
});

test(
  "owned connection reports survive restart, reject stale/forged updates and retain immutable exports after local removal",
  { timeout: 25000 },
  async () => {
    const f = await taskFixture({ services: true });
    try {
      const service = await hosted(f),
        path = `/api/services/${service.identity.serviceId}/connections`;
      const project = report(service),
        exported = report(service, {
          kind: "export",
          referenceId: "export-one",
        });
      expectStatus(await f.request(path, { body: project }), 200);
      expectStatus(await f.request(path, { body: exported }), 404);
      expectStatus(await control(f, service, "activate"), 200);
      const first = await f.request(path, { body: exported });
      expectStatus(first, 200);
      assert.equal(first.body.records.length, 2);
      await f.restart();
      const replay = await f.request(path, { body: exported });
      expectStatus(replay, 200);
      assert.deepEqual(replay.body.records, first.body.records);
      for (const session of [null, f.otherCookie])
        expectStatus(await f.request(path, { session }), session ? 404 : 401);
      expectStatus(
        await f.request(path, {
          body: project,
          headers: { Origin: "https://foreign.test" },
        }),
        403,
      );
      expectStatus(
        await f.request(path, {
          body: { ...project, referenceId: "foreign", projectId: "foreign" },
        }),
        404,
      );
      expectStatus(
        await f.request(path, { body: { ...project, authority: "approved" } }),
        400,
      );
      expectStatus(
        await f.request(path, {
          body: {
            ...project,
            components: [{ ...project.components[0], operation: "guests" }],
          },
        }),
        403,
      );
      expectStatus(
        await f.request(path, {
          body: { ...exported, title: "Different bytes" },
        }),
        409,
      );
      expectStatus(
        await f.request(path, { body: { ...project, components: [] } }),
        409,
      );
      expectStatus(
        await f.request(path, {
          body: { ...project, expectedRevision: 1, components: [] },
        }),
        200,
      );
      expectStatus(await f.request(path, { body: project }), 409);
      const remaining = (await f.request(path)).body.records;
      assert.equal(
        remaining.find((r) => r.report.kind === "project").report.components
          .length,
        0,
      );
      assert.equal(
        remaining.find((r) => r.report.kind === "export").report.components
          .length,
        1,
      );
      expectStatus(await publicCall(f, service, action("saved-viewer")), 200);
      const next = await version(f, service);
      expectStatus(await control(f, next, "activate"), 200);
      expectStatus(await publicCall(f, next, action("saved-viewer")), 200);
      expectStatus(await control(f, next, "pause"), 200);
      expectStatus(await f.request(path), 200);
      expectStatus(
        await f.request(path, {
          body: { ...exported, referenceId: "another-export" },
        }),
        409,
      );
      expectStatus(await control(f, next, "delete"), 200);
      expectStatus(await f.request(path), 404);
      expectStatus(await f.request(path, { body: project }), 404);
    } finally {
      await f.close();
    }
  },
);

test(
  "published link reports require an owned ready PVO and an already recorded export; replay is bounded and private",
  { timeout: 25000 },
  async () => {
    const f = await taskFixture({ services: true });
    try {
      const service = await hosted(f),
        base = `/api/services/${service.identity.serviceId}`;
      expectStatus(await control(f, service, "activate"), 200);
      const db = await f.database();
      const seed = async (id, owner, status = "ready", format = "pvo") =>
        db
          .prepare(
            `INSERT INTO publications(id,owner_id,idempotency_key,title,filename,format,content_type,bytes,created_at,expires_at,status) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .bind(
            id,
            owner,
            id,
            "Published dinner",
            "dinner.pvo",
            format,
            "application/octet-stream",
            100,
            1,
            9999999999999,
            status,
          )
          .run();
      await seed("published-one", service.identity.ownerId);
      const other = await db
        .prepare("SELECT id FROM users WHERE id != ?")
        .bind(service.identity.ownerId)
        .first();
      await seed("foreign-link", other.id);
      await seed("pending-link", service.identity.ownerId, "pending");
      await seed("video-link", service.identity.ownerId, "ready", "video");
      const input = { exportId: "export-one", publicationId: "published-one" };
      expectStatus(
        await f.request(base + "/publication", { body: input }),
        404,
      );
      expectStatus(
        await f.request(base + "/connections", {
          body: report(service, { kind: "export", referenceId: "export-one" }),
        }),
        200,
      );
      for (const [publicationId, expected] of [
        ["foreign-link", 404],
        ["pending-link", 409],
        ["video-link", 409],
      ])
        expectStatus(
          await f.request(base + "/publication", {
            body: { ...input, publicationId },
          }),
          expected,
        );
      const first = await f.request(base + "/publication", { body: input });
      expectStatus(first, 200);
      await f.restart();
      const second = await f.request(base + "/publication", { body: input });
      expectStatus(second, 200);
      assert.deepEqual(second.body.records, first.body.records);
      assert.deepEqual(
        second.body.records[0].publications.map((p) => [p.id, p.title]),
        [["published-one", "Published dinner"]],
      );
      expectStatus(
        await f.request(base + "/publication", {
          body: input,
          session: f.otherCookie,
        }),
        404,
      );
    } finally {
      await f.close();
    }
  },
);

test(
  "connection storage fills without evicting old exports or blocking project removal, pause and deletion",
  { timeout: 25000 },
  async () => {
    const f = await taskFixture({ services: true });
    try {
      const service = await hosted(f),
        path = `/api/services/${service.identity.serviceId}/connections`;
      expectStatus(await control(f, service, "activate"), 200);
      for (let index = 0; index < 64; index++)
        expectStatus(
          await f.request(path, {
            body: report(service, {
              kind: "export",
              referenceId: `export-${index}`,
            }),
          }),
          200,
        );
      expectStatus(
        await f.request(path, {
          body: report(service, { kind: "export", referenceId: "overflow" }),
        }),
        429,
      );
      expectStatus(await f.request(path, { body: report(service) }), 200);
      expectStatus(
        await f.request(path, {
          body: report(service, { expectedRevision: 1, components: [] }),
        }),
        200,
      );
      const entries = await f.request(path);
      expectStatus(entries, 200);
      assert.equal(entries.body.records.length, 65);
      assert(
        entries.body.records.some(
          (record) => record.report.referenceId === "export-0",
        ),
      );
      expectStatus(await control(f, service, "pause"), 200);
      expectStatus(await control(f, service, "delete"), 200);
      expectStatus(await f.request(path), 404);
    } finally {
      await f.close();
    }
  },
);
