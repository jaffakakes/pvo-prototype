import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { initSync } from "../../packages/pvo-language/pkg/pvo_language.js";
import { compilePvoComponent } from "../../packages/pvo-language/index.js";
import { prepareServicePublication } from "../../server/cloud-services/releaseContract.js";
import { checkedFixture } from "../service-hosting/fixtures.mjs";
import { createTask } from "../../packages/pvo-assistant/tasks/index.js";
import { prepareServiceAttachmentReceipt } from "../../packages/pvo-assistant/attachments/index.js";
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

test("existing Container attachment preserves component appearance/routes, checks typed bindings, and commits in one Undo step", async () => {
  api.useCapture.setState(api.initial());
  api.useCapture.getState().patch({ screen: "editor", localId: "local" });
  api.useEditorPreferences.setState({ advancedEditingEnabled: false });
  const before = api.projectSnapshot(api.useCapture.getState());
  const scene = before.scenes[0];
  const component = api.createDefaultComponent("existing", "form", scene, 0);
  component.fields = {
    formFields: [{ name: "Guest", type: "text" }],
    heading: "Dinner",
    submitLabel: "Join",
    formSubmitMode: "local",
    outcome: { kind: "continue" },
  };
  scene.components = [component];
  api.useCapture.getState().patch({ scenes: before.scenes });
  const current = api.projectSnapshot(api.useCapture.getState());
  const input = api.cloudTaskInput(current, "Dinner", proposal, {
    projectId: "project",
    operationId: "create",
    fingerprint: api.nativeProjectFingerprint(current),
  });
  const now = Date.now();
  const task = createTask(input, {
    id: "builder",
    ownerId: "owner",
    inputDigest: "a".repeat(64),
    now,
  });
  const publication = await prepareServicePublication(
    task,
    "host",
    await checkedFixture(),
    now + 86400000,
  );
  const receipt = prepareServiceAttachmentReceipt(
    publication,
    { identity: publication.identity, state: "retained" },
    "join",
    now,
  );
  const source = api.componentLanguageSource(component);
  const compiled = await compilePvoComponent(component.type, source);
  const target = api.connectionTargets(compiled)[0];
  const binding = api.defaultInputBinding(
    receipt.operation.input,
    api.connectionFields(compiled.structure),
  );
  assert.equal(binding.fields[0].value.kind, "field");
  const authorization = api.proposeContainerConnection(
    component,
    scene.id,
    compiled,
    receipt,
    target,
    binding,
    "https://restyle.example",
    now,
  );
  assert.equal(
    authorization.command.component.source.structure,
    source.structure,
  );
  assert.equal(authorization.command.component.source.style, source.style);
  const batch = await api.prepareNativeBatch(
    current,
    [authorization.command.component],
    {
      createId: () => 9,
      compile: compilePvoComponent,
      advancedEditingEnabled: false,
      attachment: authorization,
    },
  );
  const saved = batch.project.scenes[0].components[0];
  assert.equal(saved.id, component.id);
  assert.equal(
    saved.serviceConnection.receipt.identity.serviceId,
    publication.identity.serviceId,
  );
  assert.deepEqual(batch.project.allowedDomains, ["restyle.example"]);
  assert.equal(
    api.commitNativeBatch(batch, api.nativeProjectFingerprint(current), "edit"),
    true,
  );
  api.useCapture.getState().undo();
  assert.equal(
    api.projectSnapshot(api.useCapture.getState()).scenes[0].components[0]
      .serviceConnection,
    undefined,
  );
  assert.throws(() =>
    api.proposeContainerConnection(
      component,
      scene.id,
      compiled,
      receipt,
      target,
      { kind: "literal", value: 42 },
      "https://restyle.example",
      now,
    ),
  );
  const missing = api.proposeContainerConnection(
    component,
    scene.id,
    compiled,
    receipt,
    target,
    {
      kind: "object",
      fields: [{ name: "name", value: { kind: "field", name: "missing" } }],
    },
    "https://restyle.example",
    now,
  );
  await assert.rejects(
    api.prepareNativeBatch(current, [missing.command.component], {
      createId: () => 9,
      compile: compilePvoComponent,
      advancedEditingEnabled: false,
      attachment: missing,
    }),
    /missing form field/,
  );
  const attached = await compilePvoComponent(
    component.type,
    authorization.command.component.source,
  );
  assert.deepEqual(
    api.connectionTargets(attached),
    [],
    "existing requests cannot be replaced by this attachment capability",
  );
  api.useCapture.getState().edit({ ratio: "1:1" });
  assert.throws(
    () =>
      api.commitNativeBatch(
        batch,
        api.nativeProjectFingerprint(current),
        "edit",
      ),
    /project changed/,
  );
});
