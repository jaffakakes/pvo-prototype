import assert from "node:assert/strict";
import test from "node:test";
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
  prepareServiceSubmission,
  retryServiceSubmission,
  completeServiceSubmission,
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
      const saved = prepareServiceSubmission(
        target,
        resolveServiceSubmissionInput(connection, { guest: "Alice" }),
        "submission-one",
      );
      // The adapter persists before dispatch. The first real response is deliberately discarded.
      const storage = JSON.stringify(saved);
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
      expectStatus(await send(saved), 200);
      assert.equal(saved.response, null);
      await f.restart();
      const restored = retryServiceSubmission(JSON.parse(storage), target);
      const reply = await send(restored);
      expectStatus(reply, 200);
      assert.equal(reply.body.result, "accepted");
      assert.equal(executions, 1);
      const complete = completeServiceSubmission(restored, reply.body);
      assert.deepEqual(
        retryServiceSubmission(JSON.parse(JSON.stringify(complete)), target),
        complete,
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
      const distinct = prepareServiceSubmission(
        target,
        { name: "Alice" },
        "submission-two",
      );
      const second = await send(distinct);
      expectStatus(second, 200);
      assert.equal(second.body.result, "already_joined");
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
