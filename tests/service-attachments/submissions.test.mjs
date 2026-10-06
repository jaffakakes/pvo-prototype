import assert from "node:assert/strict";
import test from "node:test";
import {
  prepareServiceAttachmentReceipt,
  prepareServiceSubmissionTarget,
  resolveServiceSubmissionInput,
  prepareServiceSubmission,
  parseServiceSubmission,
  retryServiceSubmission,
  completeServiceSubmission,
  serviceSubmissionRequest,
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
const connection = {
  origin: "https://services.example",
  receipt: prepareServiceAttachmentReceipt(
    publication,
    { identity: publication.identity, state: "available" },
    "join",
    now,
  ),
  connection: attachment(publication.identity.resourceId).connection,
};
const publicScope = { mode: "public", ownerId: null };
const target = prepareServiceSubmissionTarget(connection, publicScope);

test("a saved submission freezes typed input and retries exact bytes after client serialization", () => {
  const fields = { guest: "Alice" };
  const input = resolveServiceSubmissionInput(connection, fields);
  const saved = prepareServiceSubmission(target, input, "action-one");
  const request = serviceSubmissionRequest(saved);
  fields.guest = "Bob";
  input.name = "Charlie";
  const restored = retryServiceSubmission(
    JSON.parse(JSON.stringify(saved)),
    target,
  );
  assert.deepEqual(restored.action, {
    actionId: "action-one",
    operation: "join",
    input: { name: "Alice" },
  });
  assert.deepEqual(serviceSubmissionRequest(restored), request);
  assert.deepEqual(Object.keys(JSON.parse(request.body)).sort(), [
    "actionId",
    "input",
    "operation",
  ]);
  assert.ok(request.url.endsWith("/actions"));
  const next = prepareServiceSubmission(
    target,
    resolveServiceSubmissionInput(connection, fields),
    "action-two",
  );
  assert.equal(next.action.actionId, "action-two");
  assert.deepEqual(next.action.input, { name: "Bob" });
  assert.equal(saved.response, null);
});

test("retry cannot cross origin, account, mode, service, release or operation description", () => {
  const saved = prepareServiceSubmission(
    target,
    { name: "Alice" },
    "action-one",
  );
  for (const change of [
    { origin: "https://other.example" },
    { serviceId: "service-" + "a".repeat(64) },
    { releaseId: "another-release" },
    { mode: "try", ownerId: connection.receipt.identity.ownerId },
    { operation: { ...target.operation, description: "Changed operation" } },
  ])
    assert.throws(
      () => retryServiceSubmission(saved, { ...target, ...change }),
      /another connection/,
    );
  assert.throws(
    () =>
      prepareServiceSubmissionTarget(connection, {
        mode: "try",
        ownerId: "foreign",
      }),
    /different account/,
  );
  assert.throws(
    () =>
      prepareServiceSubmissionTarget(connection, {
        mode: "public",
        ownerId: "creator",
      }),
    /do not contain/,
  );
  const ownTarget = prepareServiceSubmissionTarget(connection, {
    mode: "try",
    ownerId: connection.receipt.identity.ownerId,
  });
  const own = prepareServiceSubmission(ownTarget, { name: "Alice" }, "try-one");
  assert.ok(serviceSubmissionRequest(own).url.endsWith("/try"));
  assert.throws(
    () => retryServiceSubmission(own, { ...ownTarget, ownerId: "different" }),
    /another connection/,
  );
  assert.deepEqual(Object.keys(target).sort(), [
    "mode",
    "operation",
    "origin",
    "ownerId",
    "releaseId",
    "serviceId",
  ]);
  assert.equal(target.ownerId, null);
});

test("bindings preserve nested literals and typed numbers/booleans; missing fields and coercion are rejected", () => {
  const typed = structuredClone(connection);
  typed.receipt.operation.input = {
    type: "object",
    fields: [
      {
        name: "count",
        description: "Guests",
        schema: { type: "integer", minimum: 1, maximum: 4 },
      },
      {
        name: "confirmed",
        description: "Confirmed",
        schema: { type: "boolean" },
      },
      {
        name: "tags",
        description: "Tags",
        schema: {
          type: "array",
          maxItems: 2,
          items: { type: "string", maxBytes: 64 },
        },
      },
    ],
  };
  typed.connection.input = {
    kind: "object",
    fields: [
      { name: "count", value: { kind: "field", name: "guests" } },
      { name: "confirmed", value: { kind: "field", name: "yes" } },
      {
        name: "tags",
        value: {
          kind: "array",
          items: [{ kind: "literal", value: "{state.text} is plain data" }],
        },
      },
    ],
  };
  assert.deepEqual(
    resolveServiceSubmissionInput(typed, { guests: 2, yes: false }),
    { count: 2, confirmed: false, tags: ["{state.text} is plain data"] },
  );
  for (const fields of [
    { guests: "2", yes: false },
    { guests: 2, yes: "false" },
    { guests: 5, yes: true },
    { guests: 1.5, yes: true },
    { guests: 2 },
  ])
    assert.throws(() => resolveServiceSubmissionInput(typed, fields));
  assert.throws(() =>
    resolveServiceSubmissionInput(
      connection,
      Object.create({ guest: "Inherited" }),
    ),
  );
  let invoked = false;
  const fields = Object.defineProperty({}, "guest", {
    enumerable: true,
    get() {
      invoked = true;
      return "Alice";
    },
  });
  assert.throws(() => resolveServiceSubmissionInput(connection, fields));
  assert.equal(invoked, false);
  const saved = prepareServiceSubmission(target, { name: "Alice" }, "one");
  saved.action.input = Object.defineProperty({}, "name", {
    enumerable: true,
    get() {
      invoked = true;
      return "Alice";
    },
  });
  assert.throws(() => parseServiceSubmission(saved));
  assert.equal(invoked, false);
});

test("only a matching bounded result completes the saved action and completion cannot be overwritten", () => {
  const saved = prepareServiceSubmission(
    target,
    { name: "Alice" },
    "action-one",
  );
  for (const response of [
    { actionId: "other", result: "accepted" },
    { actionId: "action-one", result: "invented" },
    { actionId: "action-one", result: "accepted", extra: true },
  ])
    assert.throws(() => completeServiceSubmission(saved, response));
  assert.equal(saved.response, null);
  const reply = { actionId: "action-one", result: "accepted" };
  const complete = completeServiceSubmission(saved, reply);
  reply.result = "full";
  assert.equal(complete.response.result, "accepted");
  assert.deepEqual(
    completeServiceSubmission(complete, complete.response),
    complete,
  );
  assert.throws(
    () => completeServiceSubmission(complete, reply),
    /cannot change/,
  );
  assert.throws(() => serviceSubmissionRequest(complete), /saved response/);
  assert.deepEqual(
    retryServiceSubmission(JSON.parse(JSON.stringify(complete)), target),
    complete,
  );
  for (const altered of [
    { ...saved, extra: true },
    { ...saved, target: { ...target, mode: "live" } },
    {
      ...saved,
      action: { ...saved.action, input: { name: "x".repeat(10000) } },
    },
  ])
    assert.throws(() => parseServiceSubmission(altered));
});
