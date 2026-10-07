import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { initSync } from "../../packages/pvo-language/pkg/pvo_language.js";
import { compilePvoComponent } from "../../packages/pvo-language/index.js";
import {
  createTask,
  transitionTask,
} from "../../packages/pvo-assistant/tasks/index.js";
import {
  prepareTaskResult,
  parsePreparedTaskResult,
  serializePreparedTaskResult,
} from "../../packages/pvo-assistant/results/index.js";
import {
  prepareServiceAttachmentReceipt,
  serviceAttachmentRequest,
} from "../../packages/pvo-assistant/attachments/index.js";
import { prepareServicePublication } from "../../server/cloud-services/releaseContract.js";
import { checkedFixture } from "../service-hosting/fixtures.mjs";
import { attachment } from "../service-attachments/fixtures.mjs";
import { api, proposal } from "./helpers.mjs";

initSync({
  module: new WebAssembly.Module(
    await readFile(
      new URL(
        "../../packages/pvo-language/pkg/pvo_language_bg.wasm",
        import.meta.url,
      ),
    ),
  ),
});
const state = () => api.useCapture.getState();
const project = () => api.projectSnapshot(state());
const now = Date.now();
const origin = "https://restyle.example";
async function fixture() {
  api.useCapture.setState(api.initial());
  api.useEditorPreferences.setState({ advancedEditingEnabled: false });
  api.useAuthGate.setState({
    phase: "ready",
    user: { id: "owner", name: "Owner" },
  });
  state().patch({ screen: "editor", localId: "local" });
  const input = api.cloudTaskInput(project(), "Build a dinner form", proposal, {
    projectId: "server",
    operationId: "create",
    fingerprint: api.nativeProjectFingerprint(project()),
  });
  let task = createTask(input, {
    id: "task",
    ownerId: "owner",
    inputDigest: "a".repeat(64),
    now,
  });
  api.linkSavedTask(api.beginTaskLinkRequest(), task);
  const publication = await prepareServicePublication(
    task,
    "host-one",
    await checkedFixture(),
    task.createdAt + 86_400_000,
  );
  const receipt = prepareServiceAttachmentReceipt(
    publication,
    { identity: publication.identity, state: "available" },
    "join",
    now,
  );
  const command = attachment(publication.identity.resourceId);
  const authorization = {
    command,
    receipt,
    scope: { ownerId: "owner", projectId: "server", taskId: "task" },
    origin,
    now,
  };
  command.component.source = {
    structure:
      '<form><heading>Join dinner</heading><field name="guest" kind="name" label="Name"/><submit>Join</submit></form>',
    style: "",
    logic: `on submit { request(${JSON.stringify({ ...serviceAttachmentRequest(authorization), onSuccess: { kind: "continue" }, onError: null })}); }`,
  };
  const result = prepareTaskResult(task, [command.component], {
    command,
    receipt,
  });
  const body = serializePreparedTaskResult(result);
  const artifact = {
    id: task.id,
    bytes: Buffer.byteLength(body),
    sha256: createHash("sha256").update(body).digest("hex"),
  };
  const update = (change) => {
    task = transitionTask(task, change, {
      ownerId: task.ownerId,
      expectedRevision: task.revision,
      now,
      claim: task.claim
        ? { id: task.claim.id, generation: task.generation }
        : null,
    });
  };
  update({ kind: "claim", claimId: "worker", leaseMs: 60000 });
  update({
    kind: "complete",
    result: { artifact, baseFingerprint: input.context.fingerprint },
  });
  let stored;
  const adapters = {
    begin: api.beginTaskLinkRequest,
    assert: api.assertTaskLinkRequest,
    flush: async () => {
      stored = api.storeCheckpoint(
        api.captureCheckpoint(state()),
        new Map(),
        now,
      );
    },
    project,
    fingerprint: api.nativeProjectFingerprint,
    read: async () => task,
    result: async () => result,
    prepare: (before, value, signal) =>
      api.prepareSavedResult(before, value, {
        compile: compilePvoComponent,
        createId: () => 42,
        advancedEditingEnabled: false,
        origin,
        now,
        signal,
      }),
    commit: api.commitSavedTaskResult,
  };
  const apply = api.createTaskApplicationWorkflow(adapters);
  return {
    result,
    adapters,
    stored: () => stored,
    apply: () => apply(authorization.scope, new AbortController().signal),
  };
}

test("saved service connection, compiled request and approved host apply atomically through Undo, Redo and reload", async () => {
  const f = await fixture();
  const before = project();
  await f.apply();
  assert.equal(state().past.length, 1);
  const component = state().components[0];
  assert.deepEqual(component.serviceConnection, {
    receipt: f.result.attachment.receipt,
    connection: f.result.attachment.command.connection,
    origin,
  });
  assert.deepEqual(state().allowedDomains, ["restyle.example"]);
  assert.equal(component.code.pvoCompiled.rules[0].action.kind, "request");
  assert.equal(
    component.code.pvoCompiled.rules[0].action.onError,
    null,
    "failed requests remain visible through the existing error surface",
  );
  const restored = api.restoreCheckpoint(f.stored(), new Map());
  assert.deepEqual(restored.project, project());
  state().undo();
  assert.deepEqual(project(), before);
  await f.apply();
  assert.deepEqual(project(), before, "the apply-once receipt survives Undo");
  state().redo();
  assert.deepEqual(
    state().components[0].serviceConnection,
    component.serviceConnection,
  );
  assert.notEqual(
    state().components[0].serviceConnection,
    component.serviceConnection,
    "history owns detached metadata",
  );
  const changed = structuredClone(project());
  changed.scenes[0].components[0].serviceConnection.connection.input.fields[0].value.name =
    "other";
  assert.notEqual(
    api.nativeProjectFingerprint(changed),
    api.nativeProjectFingerprint(project()),
  );
});

test("saved result rejects extra authority, missing or duplicate proposal matches and foreign receipt scope", async () => {
  const { result } = await fixture();
  for (const mutate of [
    (value) => {
      delete value.attachment;
    },
    (value) => {
      value.attachment.origin = "https://attacker.example";
    },
    (value) => {
      value.attachment.receipt.identity.ownerId = "other";
    },
    (value) => {
      value.operations[0].at = 1;
    },
    (value) => {
      value.operations.push(structuredClone(value.operations[0]));
    },
    (value) => {
      value.attachment.command.connection.operation = "other";
    },
  ]) {
    const value = JSON.parse(JSON.stringify(result));
    mutate(value);
    assert.throws(() => parsePreparedTaskResult(value));
  }
});

test("expired readiness, wrong platform, compiler failure and edited connection leave no partial project or application receipt", async () => {
  for (const failure of ["expired", "origin", "compile", "metadata", "host"]) {
    const f = await fixture();
    const before = project();
    f.adapters.prepare = async (draft, result, signal) => {
      const batch = await api.prepareSavedResult(draft, result, {
        compile:
          failure === "compile"
            ? async () => {
                throw new Error("Compiler failed");
              }
            : compilePvoComponent,
        createId: () => 42,
        advancedEditingEnabled: true,
        signal,
        origin: failure === "origin" ? "https://wrong.example" : origin,
        now:
          failure === "expired"
            ? result.attachment.receipt.identity.expiresAt
            : now,
      });
      if (failure === "metadata")
        batch.project.scenes[0].components[0].serviceConnection.connection.operation =
          "other";
      if (failure === "host") batch.project.allowedDomains = [];
      return batch;
    };
    await assert.rejects(f.apply());
    assert.deepEqual(project(), before);
    assert.equal(state().past.length, 0);
    assert.equal(state().assistantTaskLinks.applied, undefined);
  }
});

test("account or local edits during connection preparation block the whole apply", async () => {
  for (const change of ["account", "edit"]) {
    const f = await fixture();
    const prepare = f.adapters.prepare;
    f.adapters.prepare = async (...args) => {
      const batch = await prepare(...args);
      if (change === "account")
        api.useAuthGate.setState({ user: { id: "other", name: "Other" } });
      else state().edit({ ratio: "16:9" });
      return batch;
    };
    await assert.rejects(
      f.apply(),
      change === "account" ? /account changed/ : /project changed/,
    );
    assert.equal(state().components.length, 0);
    assert.deepEqual(state().allowedDomains, []);
    assert.equal(state().assistantTaskLinks.applied, undefined);
    if (change === "edit") assert.equal(state().ratio, "16:9");
  }
});
