import assert from "node:assert/strict";
import test from "node:test";
import {
  taskFixture,
  expectStatus,
  hosted,
  control,
  version,
  action,
  publicCall,
  inspect,
} from "../service-actions/helpers.mjs";
import { attachment } from "./fixtures.mjs";
import { parsePublishedServiceOperations } from "../../packages/pvo-assistant/attachments/index.js";
const options = { timeout: 25000 };

test(
  "published operations and attachment use actual checked source, owner/project/current release and public operations only",
  options,
  async () => {
    const f = await taskFixture({ services: true });
    try {
      const service = await hosted(f),
        base = `/api/services/${service.identity.serviceId}`;
      expectStatus(await f.request(base + "/operations"), 404);
      expectStatus(await control(f, service, "activate"), 200);
      expectStatus(
        await f.request(base + "/operations", { session: null }),
        401,
      );
      expectStatus(
        await f.request(base + "/operations", { session: f.otherCookie }),
        404,
      );
      const operations = await f.request(base + "/operations");
      expectStatus(operations, 200);
      const parsed = parsePublishedServiceOperations(operations.body);
      assert.deepEqual(
        parsed.operations.map((item) => item.operation.name),
        ["join"],
      );
      assert(!JSON.stringify(parsed).includes('"source"'));
      assert(!JSON.stringify(parsed).includes('"guests"'));
      const command = attachment(service.identity.resourceId);
      const input = { projectId: service.identity.projectId, command };
      const prepared = await f.request(base + "/attachment", { body: input });
      expectStatus(prepared, 200);
      assert.deepEqual(prepared.body.command, command);
      assert.deepEqual(prepared.body.receipt, parsed.operations[0]);
      assert.equal((await inspect(f, service)).receipts.length, 0);
      expectStatus(
        await f.request(base + "/attachment", {
          body: input,
          session: f.otherCookie,
        }),
        404,
      );
      expectStatus(
        await f.request(base + "/attachment", {
          body: input,
          headers: { Origin: "https://foreign.test" },
        }),
        403,
      );
      expectStatus(
        await f.request(base + "/attachment", {
          body: { ...input, projectId: "another-project" },
        }),
        404,
      );
      expectStatus(
        await f.request(base + "/attachment", {
          body: { ...input, readiness: true },
        }),
        400,
      );
      expectStatus(
        await f.request(base + "/attachment", {
          body: {
            ...input,
            command: {
              ...command,
              connection: {
                ...command.connection,
                operation: "guests",
                input: { kind: "literal", value: null },
              },
            },
          },
        }),
        403,
      );
      expectStatus(
        await f.request(base + "/attachment", {
          body: {
            ...input,
            command: {
              ...command,
              connection: {
                ...command.connection,
                input: { kind: "literal", value: 12 },
              },
            },
          },
        }),
        400,
      );
      await f.restart();
      assert.deepEqual(
        (await f.request(base + "/attachment", { body: input })).body,
        prepared.body,
      );
      const next = await version(f, service);
      expectStatus(await control(f, next, "activate"), 200);
      expectStatus(await f.request(base + "/attachment", { body: input }), 409);
      expectStatus(await control(f, service, "pause"), 200);
      expectStatus(await f.request(base + "/operations"), 404);
      expectStatus(await f.request(base + "/attachment", { body: input }), 404);
      expectStatus(await control(f, service, "delete"), 200);
      expectStatus(await f.request(base + "/operations"), 404);
    } finally {
      await f.close();
    }
  },
);

test(
  "component Try keeps an exact retained published version while a new draft is tested, without touching live data",
  options,
  async () => {
    const f = await taskFixture({ services: true });
    try {
      const service = await hosted(f);
      expectStatus(await control(f, service, "activate"), 200);
      const next = await version(f, service);
      const path = `/api/services/${service.identity.serviceId}/releases/${service.identity.resourceId}/try`;
      const first = await f.request(path, {
        body: action("old-version", "Test"),
      });
      expectStatus(first, 200);
      expectStatus(await control(f, next, "activate"), 200);
      await f.restart();
      assert.deepEqual(
        (await f.request(path, { body: action("old-version", "Test") })).body,
        first.body,
      );
      expectStatus(
        await f.request(path, {
          body: action("wrong-owner"),
          session: f.otherCookie,
        }),
        404,
      );
      expectStatus(
        await f.request(path, {
          body: { actionId: "private", operation: "guests", input: null },
        }),
        403,
      );
      assert.equal(
        (await publicCall(f, next, action("live", "Viewer"))).body.result,
        "accepted",
      );
      expectStatus(await control(f, next, "delete"), 200);
      expectStatus(
        await f.request(path, { body: action("old-version", "Test") }),
        404,
      );
    } finally {
      await f.close();
    }
  },
);
