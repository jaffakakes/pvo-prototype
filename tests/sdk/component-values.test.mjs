import assert from "node:assert/strict";
import test from "node:test";
import {
  actionForOutcome,
  formFieldDefinition,
  requestHost,
} from "../../packages/pvo-sdk/manifest/component-values.js";
import { buildSync } from "esbuild";
const bundle = buildSync({
  entryPoints: ["editor/src/domain/components/actions.ts"],
  bundle: true,
  write: false,
  format: "esm",
});
const editor = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
test("outcome conversion is shared by editor actions and portable format mapping", () => {
  for (const outcome of [
    { kind: "continue" },
    { kind: "time", t: 1.25 },
    { kind: "scene", sceneId: "branch" },
    {
      kind: "request",
      method: "POST",
      url: "https://creator.example/reply",
      body: '{"answer":"{fields.reply}"}',
      onSuccess: { kind: "continue" },
      onError: { kind: "time", t: 0 },
    },
  ])
    assert.deepEqual(
      editor.actionFor(outcome, "form"),
      actionForOutcome(outcome, "form"),
    );
  assert.deepEqual(formFieldDefinition({ name: "agreed", kind: "yesno" }), {
    name: "agreed",
    label: "Yes or no",
    type: "choice",
    options: [
      { label: "Yes", value: "yes" },
      { label: "No", value: "no" },
    ],
  });
  assert.deepEqual(
    formFieldDefinition({ name: "count", label: "Guests", kind: "number" }),
    { name: "count", label: "Guests", type: "number" },
  );
  assert.throws(() => requestHost("https://{fields.host}/reply"), /fixed host/);
});
