import test from "node:test";
import assert from "node:assert/strict";
import { serviceAccountAccess } from "../../server/cloud-services/accountAccess.js";
import { prepareServicePublication } from "../../server/cloud-services/releaseContract.js";
import { create } from "../assistant-tasks/fixtures.mjs";
import { checkedFixture } from "../service-hosting/fixtures.mjs";
import { connectedAgreement, connectedSource } from "./fixtures.mjs";

test("a delayed approval cannot undo a newer revocation or Container lifecycle change", async () => {
  const task = create(),
    checked = await checkedFixture(
      connectedSource().files[0].content,
      connectedAgreement(),
    );
  const publication = await prepareServicePublication(
    task,
    "release-one",
    checked,
    task.createdAt + 86400000,
  );
  const { ownerId, serviceId, resourceId: releaseId } = publication.identity;
  const row = {
    body: JSON.stringify(publication),
    identity: JSON.stringify(publication.identity),
  };
  let epoch = 0,
    approved = null,
    resume,
    entered;
  let ready = new Promise((resolve) => {
    entered = resolve;
  });
  let held = new Promise((resolve) => {
    resume = resolve;
  });
  let service = {
    identity: { ownerId, serviceId },
    revision: 0,
    state: "inactive",
  };
  const host = {
    store: { service: () => service, row: () => row, current: () => row },
    now: () => task.createdAt,
    accounts: {
      epoch: () => epoch,
      approval: () => approved,
      approve: () => {
        approved = true;
      },
      revoke: () => {
        epoch++;
        approved = null;
      },
    },
    calls: { cancel() {} },
    env: {
      ASSISTANT_TASKS: {
        getByName: () => ({
          manageConnections: async () => {
            entered();
            await held;
            return {
              ok: true,
              value: {
                scope: { repository: "octocat/private-work" },
                account: "octocat",
              },
            };
          },
        }),
      },
    },
  };
  const approval = serviceAccountAccess(host, serviceId, ownerId, {
    kind: "approve",
    releaseId,
  });
  await ready;
  const revocation = serviceAccountAccess(host, serviceId, ownerId, {
    kind: "revoke",
    releaseId,
  });
  resume();
  await assert.rejects(approval, (error) => error.code === "state_changed");
  assert.equal((await revocation).approved, false);
  ready = new Promise((resolve) => {
    entered = resolve;
  });
  held = new Promise((resolve) => {
    resume = resolve;
  });
  const late = serviceAccountAccess(host, serviceId, ownerId, {
    kind: "approve",
    releaseId,
  });
  await ready;
  service = { ...service, revision: 1, state: "deleted" };
  resume();
  await assert.rejects(late, (error) => error.code === "state_changed");
  assert.equal(approved, null);
});
