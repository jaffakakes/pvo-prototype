import test from "node:test";
import assert from "node:assert/strict";
import { checkedAcceptance } from "./acceptance.fixture.mjs";
import { emailProvider, emailConnect } from "./email.fixture.mjs";
import { fixture } from "../account-connections/helpers.mjs";
import {
  hosted,
  control,
  expectStatus,
  inspect,
} from "../service-actions/helpers.mjs";

test(
  "independently checked acceptance records the reply, tolerates duplicate clicks and inspects unfinished work after provider loss",
  { timeout: 30000 },
  async () => {
    const checked = await checkedAcceptance(),
      api = emailProvider(),
      f = await fixture({ services: true, connectionFetch: api.fetch });
    try {
      expectStatus(await f.connection("connect", emailConnect()), 200);
      const service = await hosted(f, { checked }),
        base = `/api/services/${service.identity.serviceId}`;
      expectStatus(
        await f.request(base + "/account-access", {
          body: { kind: "approve", releaseId: service.identity.resourceId },
        }),
        200,
      );
      expectStatus(await control(f, service, "activate"), 200);
      const body = {
        releaseId: service.identity.resourceId,
        action: {
          actionId: "acceptance",
          operation: "accept",
          input: { name: "Guest" },
        },
        receiptKey: "e".repeat(64),
        schedule: null,
      };
      expectStatus(
        await f.request(base + "/jobs", { session: null, body }),
        202,
      );
      api.lost = true;
      await f.control({
        action: "host-diagnostic",
        identity: service.identity,
        kind: "sweep",
      });
      assert.equal(
        (await f.request(base + "/jobs")).body.jobs[0].status,
        "needs_checking",
      );
      await f.restart();
      expectStatus(
        await f.request(base + "/job-control", {
          body: { actionId: "acceptance", kind: "resume" },
        }),
        200,
      );
      await f.control({
        action: "host-diagnostic",
        identity: service.identity,
        kind: "sweep",
      });
      expectStatus(
        await f.request(base + "/jobs", { session: null, body }),
        202,
      );
      assert.equal(api.sends, 1);
      assert.deepEqual(
        JSON.parse(
          (await inspect(f, service)).data.find(
            (row) => row.namespace === "live",
          ).body,
        ),
        { guests: ["Guest"] },
      );
    } finally {
      await f.close();
    }
  },
);
