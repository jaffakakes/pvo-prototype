import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  taskFixture,
  expectStatus,
  hosted,
  control,
  inspect,
} from "./helpers.mjs";
import { ORIGIN, NOW } from "../assistant-task-server/helpers.mjs";
import { checkedFixture } from "../service-hosting/fixtures.mjs";
import { attachment } from "../service-attachments/fixtures.mjs";
import {
  prepareServiceAttachmentReceipt,
  prepareServiceSubmissionTarget,
  resolveServiceSubmissionInput,
  createServiceSubmissionClient,
  retryServiceSubmission,
  serviceSubmissionRequest,
} from "../../packages/pvo-assistant/attachments/index.js";

for (const mode of ["try", "public"]) {
  test(`shared ${mode} submission restores its lost reply from actual server storage without repeating an action`, async () => {
    let executions = 0;
    const f = await taskFixture({
      services: true,
      hostControl: async () => {
        executions++;
        return Response.json({});
      },
    });
    try {
      const service = await hosted(f);
      if (mode === "public")
        expectStatus(await control(f, service, "activate"), 200);
      const row = (await f.control({ action: "provider-rows" })).body[0];
      const observed = (
        await f.control({
          action: "provider-status",
          identity: service.identity,
        })
      ).body.observation;
      const connection = {
        origin: ORIGIN,
        receipt: prepareServiceAttachmentReceipt(
          { identity: row.identity, ...(await checkedFixture()) },
          observed,
          "join",
          NOW,
        ),
        connection: attachment(service.identity.resourceId).connection,
      };
      const target = prepareServiceSubmissionTarget(connection, {
        mode,
        ownerId: mode === "try" ? service.task.ownerId : null,
      });
      // Controlled serialized client storage; the separate Chromium check verifies the IndexedDB adapter.
      let serialized = null;
      const store = {
        read: async () => (serialized === null ? null : JSON.parse(serialized)),
        update: async (_slot, change) => {
          serialized = JSON.stringify(
            change(serialized === null ? null : JSON.parse(serialized)),
          );
          return JSON.parse(serialized);
        },
      };
      const send = async (value, overrides = {}) => {
        const request = serviceSubmissionRequest(value);
        return f.request(new URL(request.url).pathname, {
          body: JSON.parse(request.body),
          ...(mode === "public"
            ? { session: null, headers: { Origin: "https://viewer.example" } }
            : {}),
          ...overrides,
        });
      };
      let loseReply = true,
        sends = 0;
      const adapters = {
        store,
        createId: randomUUID,
        send: async (request) => {
          sends++;
          const stored = await store.read();
          assert.deepEqual(
            serviceSubmissionRequest(stored),
            request,
            "The exact intent commits before transport",
          );
          const response = await send(stored);
          expectStatus(response, 200);
          if (loseReply) throw new Error("Controlled lost successful reply");
          return response.body;
        },
      };
      let client = createServiceSubmissionClient(adapters);
      const active = { isCurrent: () => true };
      await assert.rejects(
        client.submit(
          "component",
          target,
          resolveServiceSubmissionInput(connection, { guest: "Alice" }),
          active,
        ),
        /lost successful reply/,
      );
      const saved = await store.read();
      assert.equal(saved.response, null);
      await f.restart();
      loseReply = false;
      client = createServiceSubmissionClient(adapters);
      const restored = retryServiceSubmission(saved, target);
      const complete = await client.retry("component", target, active);
      assert.equal(complete.response.result, "accepted");
      assert.equal(executions, 1);
      assert.deepEqual(
        await client.retry("component", target, active),
        complete,
      );
      assert.equal(
        sends,
        2,
        "The saved completed response needs no network retry",
      );
      const changed = {
        ...restored,
        action: { ...restored.action, input: { name: "Bob" } },
      };
      expectStatus(await send(changed), 409);
      assert.equal(
        executions,
        1,
        "Changing input under the same ID never runs generated code",
      );
      const distinct = await client.submit(
        "component",
        target,
        { name: "Alice" },
        active,
      );
      assert.notEqual(distinct.action.actionId, saved.action.actionId);
      assert.equal(distinct.response.result, "already_joined");
      assert.equal(
        executions,
        2,
        "A distinct submission is a distinct server action even for identical input",
      );
      const data = await inspect(f, service);
      assert.equal(data.receipts.length, 2);
      assert.equal(JSON.parse(data.data[0].body).guests.length, 1);
      if (mode === "try") {
        expectStatus(await send(restored, { session: null }), 401);
        expectStatus(await send(restored, { session: f.otherCookie }), 404);
      }
    } finally {
      await f.close();
    }
  });
}
