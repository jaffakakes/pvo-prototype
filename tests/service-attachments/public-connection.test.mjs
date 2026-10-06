import assert from "node:assert/strict";
import test from "node:test";
import {
  prepareServiceAttachmentReceipt,
  projectPublicServiceConnection,
  parsePublicServiceConnection,
  publicServiceSubmissionTarget,
  resolvePublicServiceSubmissionInput,
  resolveServiceSubmissionInput,
  prepareServiceSubmissionTarget,
  prepareServiceSubmission,
  retryServiceSubmission,
  serviceSubmissionRequest,
  matchesPublicServiceRequest,
  matchesComponentServiceRequest,
} from "../../packages/pvo-assistant/attachments/index.js";
import { prepareServicePublication } from "../../server/cloud-services/releaseContract.js";
import { checkedFixture } from "../service-hosting/fixtures.mjs";
import { create, now } from "../assistant-tasks/fixtures.mjs";
import { attachment } from "./fixtures.mjs";

const publication = await prepareServicePublication(
  create(),
  "host-one",
  await checkedFixture(),
  now + 86400000,
);
const saved = {
  origin: "https://services.example",
  receipt: prepareServiceAttachmentReceipt(
    publication,
    { identity: publication.identity, state: "available" },
    "join",
    now,
  ),
  connection: attachment(publication.identity.resourceId).connection,
};

test("public projection contains only invocation data and preserves shared exact input, request matching and replay", () => {
  const connection = projectPublicServiceConnection(saved);
  assert.deepEqual(Object.keys(connection).sort(), [
    "event",
    "input",
    "operation",
    "origin",
    "releaseId",
    "serviceId",
    "target",
  ]);
  for (const key of [
    "ownerId",
    "projectId",
    "taskId",
    "expiresAt",
    "sourceDigest",
    "readiness",
    "receipt",
  ])
    assert.ok(!JSON.stringify(connection).includes(JSON.stringify(key)), key);
  const otherAuthoring = structuredClone(saved);
  otherAuthoring.receipt.identity.ownerId = "another-owner";
  otherAuthoring.receipt.identity.projectId = "another-project";
  otherAuthoring.receipt.identity.taskId = "another-task";
  otherAuthoring.receipt.readiness.observedAt = now + 1;
  assert.deepEqual(projectPublicServiceConnection(otherAuthoring), connection);

  const restored = parsePublicServiceConnection(
    JSON.parse(JSON.stringify(connection)),
  );
  const fields = { guest: "Literal {state.private.name}" };
  const input = resolvePublicServiceSubmissionInput(restored, fields);
  assert.deepEqual(input, resolveServiceSubmissionInput(saved, fields));
  assert.deepEqual(input, { name: fields.guest });
  const target = publicServiceSubmissionTarget(restored);
  assert.deepEqual(
    target,
    prepareServiceSubmissionTarget(saved, { mode: "public", ownerId: null }),
  );
  const pending = prepareServiceSubmission(target, input, "viewer-action");
  const wire = serviceSubmissionRequest(pending);
  assert.equal(
    wire.url,
    `${saved.origin}/api/services/${publication.identity.serviceId}/actions`,
  );
  assert.equal(
    wire.credentials,
    undefined,
    "the host adapter owns transport credentials",
  );
  fields.guest = "Changed afterward";
  assert.deepEqual(
    serviceSubmissionRequest(
      retryServiceSubmission(JSON.parse(JSON.stringify(pending)), target),
    ),
    wire,
  );
  const declarative = {
    url: wire.url,
    method: "POST",
    body: JSON.stringify({
      input: connection.input,
      operation: connection.operation.name,
    }),
  };
  assert.equal(matchesPublicServiceRequest(restored, declarative), true);
  assert.equal(matchesComponentServiceRequest(saved, declarative), true);
  assert.equal(
    matchesPublicServiceRequest(restored, wire),
    false,
    "an executable action is not a declarative binding",
  );
  for (const change of [
    { url: wire.url + "?mode=test" },
    { method: "GET" },
    { body: "{}" },
  ])
    assert.equal(
      matchesPublicServiceRequest(restored, { ...declarative, ...change }),
      false,
    );
  connection.input.fields[0].value.name = "changed";
  assert.equal(saved.connection.input.fields[0].value.name, "guest");
  assert.equal(restored.input.fields[0].value.name, "guest");
});

test("public descriptors reject private authority, invalid service/control/schema bindings and malformed form data", () => {
  const valid = projectPublicServiceConnection(saved);
  for (const extra of [
    { ownerId: "creator" },
    { mode: "try" },
    { receipt: saved.receipt },
    { readiness: { state: "ready" } },
    { credentials: "include" },
    { source: "code" },
  ])
    assert.throws(() => parsePublicServiceConnection({ ...valid, ...extra }));
  for (const change of [
    { serviceId: "invented" },
    { releaseId: "release-one" },
    { origin: "https://user:secret@services.example" },
    { event: "execute" },
    { target: "unexpected-submit-target" },
    { operation: { ...valid.operation, audience: "creator" } },
    { input: { kind: "literal", value: "wrong type" } },
    { input: { kind: "field", name: "__proto__" } },
    { input: { kind: "object", fields: [] } },
  ])
    assert.throws(() => parsePublicServiceConnection({ ...valid, ...change }));
  for (const fields of [
    {},
    { guest: 42 },
    Object.create({ guest: "Inherited" }),
  ])
    assert.throws(() => resolvePublicServiceSubmissionInput(valid, fields));
  let getterCalled = false;
  const accessor = Object.defineProperty({}, "guest", {
    enumerable: true,
    get() {
      getterCalled = true;
      return "Alice";
    },
  });
  assert.throws(() => resolvePublicServiceSubmissionInput(valid, accessor));
  assert.equal(getterCalled, false);
  const savedAction = prepareServiceSubmission(
    publicServiceSubmissionTarget(valid),
    { name: "Alice" },
    "viewer-action",
  );
  assert.throws(
    () =>
      retryServiceSubmission(
        savedAction,
        publicServiceSubmissionTarget({
          ...valid,
          releaseId: "release-" + "f".repeat(64),
        }),
      ),
    /another connection/,
  );
});
