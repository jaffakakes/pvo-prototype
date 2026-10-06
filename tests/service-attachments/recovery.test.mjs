import assert from "node:assert/strict";
import test from "node:test";
import { dinnerAgreement } from "../service-packages/fixtures.mjs";
import {
  prepareServiceSubmission,
  recoverServiceSubmissionFields,
  createServiceSubmissionClient,
} from "../../packages/pvo-assistant/attachments/index.js";
const target = {
  origin: "https://services.example",
  serviceId: "service-" + "a".repeat(64),
  releaseId: "release-" + "b".repeat(64),
  operation: dinnerAgreement().operations[0],
  mode: "public",
  ownerId: null,
};
const binding = {
  kind: "object",
  fields: [{ name: "name", value: { kind: "field", name: "guest" } }],
};

test("saved fields are recovered literally and a changed literal or account binding cannot recover them", () => {
  const saved = prepareServiceSubmission(
    target,
    { name: "{state.other}" },
    "one",
  );
  assert.deepEqual(recoverServiceSubmissionFields(saved, target, binding), {
    guest: "{state.other}",
  });
  assert.throws(
    () =>
      recoverServiceSubmissionFields(
        saved,
        { ...target, mode: "try", ownerId: "creator" },
        binding,
      ),
    /another connection/,
  );
  assert.throws(
    () =>
      recoverServiceSubmissionFields(saved, target, {
        kind: "literal",
        value: { name: "Changed" },
      }),
    /no longer matches/,
  );
  assert.equal(saved.action.input.name, "{state.other}");
});

test("a recovery selection cannot silently replay a different tab's newer action", async () => {
  const saved = prepareServiceSubmission(target, { name: "Bob" }, "newer");
  const client = createServiceSubmissionClient({
    store: {
      read: async () => saved,
      update: () => assert.fail("Must not change storage"),
    },
    createId: () => assert.fail("Recovery needs no new ID"),
    send: () => assert.fail("Must not send another action"),
  });
  await assert.rejects(
    client.retry("slot", target, { isCurrent: () => true }, "original"),
    { code: "submission_changed" },
  );
});
