import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";
import {
  FORM_VALUE_LIMIT,
  checkedFormValues,
} from "../packages/pvo-sdk/runtime/form-values.js";
import { formValuesForComponent } from "../player/actions/form-values.js";
const bundled = buildSync({
  entryPoints: ["editor/src/domain/components/forms.ts"],
  bundle: true,
  write: false,
  format: "esm",
});
const { formValuesForSubmission } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

test("SDK, editor and player preserve all allowed reply characters", () => {
  const component = {
    kind: "form",
    fields: [{ name: "field_1", type: "text" }],
    restyle_capture: { form: true },
  };
  const editorFields = { formFields: [{ name: "Reply", type: "text" }] };
  for (const length of [500, 501, 700, FORM_VALUE_LIMIT]) {
    const values = { field_1: "a".repeat(length) };
    assert.deepEqual(checkedFormValues(values), values);
    assert.deepEqual(formValuesForComponent(component, values), values);
    assert.deepEqual(formValuesForSubmission(editorFields, values), values);
  }
  const tooLong = { field_1: "a".repeat(FORM_VALUE_LIMIT + 1) };
  for (const validate of [
    checkedFormValues,
    (value) => formValuesForComponent(component, value),
    (value) => formValuesForSubmission(editorFields, value),
  ])
    assert.throws(() => validate(tooLong), /1024/);
  assert.throws(() => checkedFormValues({ field_1: Infinity }));
  assert.throws(() => checkedFormValues(JSON.parse('{"__proto__":"bad"}')));
  assert.deepEqual(
    formValuesForSubmission(
      {
        formFields: [
          { name: "Count", type: "number" },
          { name: "Agreed", type: "yesno" },
        ],
      },
      { field_1: "12", field_2: "yes" },
    ),
    { field_1: 12, field_2: true },
  );
});
