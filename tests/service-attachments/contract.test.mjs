import assert from "node:assert/strict";
import test from "node:test";
import { parseNativeOperation } from "../../packages/pvo-assistant/native/index.js";
import {
  matchServiceAttachment,
  parseServiceAttachmentCommand,
  parseServiceAttachmentReceipt,
  prepareServiceAttachmentReceipt,
} from "../../packages/pvo-assistant/attachments/index.js";
import { prepareServicePublication } from "../../server/cloud-services/releaseContract.js";
import { checkedFixture } from "../service-hosting/fixtures.mjs";
import { create, now } from "../assistant-tasks/fixtures.mjs";
import { attachment } from "./fixtures.mjs";
const task = create();
const scope = {
  ownerId: task.ownerId,
  projectId: task.input.projectId,
  taskId: task.id,
};
const publication = await prepareServicePublication(
  task,
  "host-one",
  await checkedFixture(),
  task.createdAt + 86_400_000,
);
const observation = { identity: publication.identity, state: "available" };
const receipt = prepareServiceAttachmentReceipt(
  publication,
  observation,
  "join",
  now,
);
const command = attachment(publication.identity.resourceId);
const match = (value = command, evidence = receipt, owner = scope, at = now) =>
  matchServiceAttachment(value, evidence, owner, at);

test("attachment binds one actual public operation and copies bounded data without transferring source or private state", () => {
  const result = match();
  assert.deepEqual(result, { command, receipt });
  result.command.component.source.style = "changed";
  assert.equal(command.component.source.style, "");
  assert.deepEqual(Object.keys(receipt), [
    "identity",
    "operation",
    "readiness",
  ]);
  assert.deepEqual(
    receipt.operation,
    publication.artifact.agreement.operations[0],
  );
  assert.throws(() => parseNativeOperation(command), /unsupported/);
});

test("invented addresses, flags, releases, operations and foreign identities cannot grant attachment", () => {
  for (const key of ["url", "receipt", "ready", "token", "mode"]) {
    assert.throws(() =>
      parseServiceAttachmentCommand({ ...command, [key]: "invented" }),
    );
    assert.throws(() =>
      parseServiceAttachmentCommand({
        ...command,
        connection: { ...command.connection, [key]: "invented" },
      }),
    );
  }
  for (const key of ["ownerId", "projectId", "taskId"])
    assert.throws(
      () => match(command, receipt, { ...scope, [key]: "foreign" }),
      /different account/,
    );
  for (const key of ["releaseId", "operation"])
    assert.throws(
      () =>
        match({
          ...command,
          connection: { ...command.connection, [key]: "other" },
        }),
      /does not match/,
    );
  assert.throws(
    () =>
      prepareServiceAttachmentReceipt(publication, observation, "guests", now),
    /only public/,
  );
  assert.throws(
    () =>
      prepareServiceAttachmentReceipt(publication, observation, "missing", now),
    /no matching/,
  );
  assert.throws(() =>
    prepareServiceAttachmentReceipt(
      publication,
      {
        ...observation,
        identity: { ...observation.identity, sourceDigest: "f".repeat(64) },
      },
      "join",
      now,
    ),
  );
});

test("missing, deleted, expired and future observations are rejected; retained service readiness outlives build expiry", () => {
  for (const state of ["missing", "deleted"])
    assert.throws(() =>
      prepareServiceAttachmentReceipt(
        publication,
        { ...observation, state },
        "join",
        now,
      ),
    );
  assert.throws(
    () => match(command, receipt, scope, publication.identity.expiresAt),
    /checked again/,
  );
  assert.throws(
    () =>
      match(command, {
        ...receipt,
        readiness: { ...receipt.readiness, observedAt: now + 1 },
      }),
    /checked again/,
  );
  const retained = prepareServiceAttachmentReceipt(
    publication,
    { ...observation, state: "retained" },
    "join",
    publication.identity.expiresAt + 1,
  );
  assert.doesNotThrow(() =>
    match(command, retained, scope, publication.identity.expiresAt + 2),
  );
  assert.throws(() =>
    parseServiceAttachmentReceipt({
      ...receipt,
      operation: { ...receipt.operation, audience: "creator" },
    }),
  );
});

test("input mappings follow the closed operation description and admit typed fields without accepting executable expressions", () => {
  const withInput = (input) => ({
    ...command,
    connection: { ...command.connection, input },
  });
  assert.doesNotThrow(() =>
    match(withInput({ kind: "literal", value: { name: "Alice" } })),
  );
  for (const input of [
    { kind: "literal", value: { name: 42 } },
    { kind: "object", fields: [] },
    {
      kind: "object",
      fields: [{ name: "unknown", value: { kind: "literal", value: "Alice" } }],
    },
    { kind: "array", items: [] },
    { kind: "field", name: "guest" },
    { kind: "expression", code: "fetch(secret)" },
    { kind: "literal", value: { name: "x".repeat(10000) } },
  ])
    assert.throws(() => match(withInput(input)));
  const duplicate = structuredClone(command);
  duplicate.connection.input.fields.push(duplicate.connection.input.fields[0]);
  assert.throws(() => match(duplicate), /unique/);
  let deep = { kind: "literal", value: null };
  for (let i = 0; i < 20; i++) deep = { kind: "array", items: [deep] };
  assert.throws(() => parseServiceAttachmentCommand(withInput(deep)), /depth/);
  assert.throws(
    () =>
      parseServiceAttachmentCommand({
        ...command,
        component: {
          kind: "component.delete",
          sceneId: "main",
          componentId: "one",
        },
      }),
    /complete component/,
  );
});
