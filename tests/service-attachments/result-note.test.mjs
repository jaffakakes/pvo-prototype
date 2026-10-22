import assert from "node:assert/strict";
import test from "node:test";
import { validateServiceResultNote } from "../../packages/pvo-assistant/attachments/index.js";
import { resolveTextTemplate } from "../../packages/pvo-sdk/index.js";
import { field, record, string } from "../service-packages/fixtures.mjs";

const operation = {
  result: record(
    field("entries", {
      type: "array",
      maxItems: 3,
      items: record(field("name", string()), field("message", string())),
    }),
  ),
};
const note = (text) => ({ structure: { type: "tooltip", text }, rules: [] });
const prefix = "state.responses.component-task-one-1";

test("result Notes display declared list scalars and leave absent entries blank", () => {
  const text = `Latest messages\n{${prefix}.result.entries.0.name}: {${prefix}.result.entries.0.message}\n{${prefix}.result.entries.1.name}`;
  validateServiceResultNote(note(text), "component-task-one-1", operation);
  assert.equal(
    resolveTextTemplate(text, {
      state: {
        responses: {
          "component-task-one-1": {
            result: { entries: [{ name: "Ada", message: "Hello" }] },
          },
        },
      },
    }),
    "Latest messages\nAda: Hello\n",
  );
  for (const path of [
    "result",
    "result.entries",
    "result.entries.0",
    "result.entries.3.name",
    "result.entries.-1.name",
    "result.entries.0.secret",
    "state.entries",
    "job.result.entries.0.name",
  ])
    assert.throws(() =>
      validateServiceResultNote(
        note(`{${prefix}.${path}}`),
        "component-task-one-1",
        operation,
      ),
    );
  for (const text of [
    "Saved!",
    "{response.result}",
    "{state.responses.other.result}",
    `{${prefix}.result.entries.0.name} {state.private.value}`,
  ])
    assert.throws(() =>
      validateServiceResultNote(note(text), "component-task-one-1", operation),
    );
});

test("background Notes use actual job status and result, without accepting an ordinary reply path or action", () => {
  const background = { ...operation, delivery: "background" };
  validateServiceResultNote(
    note(`{${prefix}.job.label}: {${prefix}.job.result.entries.0.message}`),
    "component-task-one-1",
    background,
  );
  assert.throws(() =>
    validateServiceResultNote(
      note(`{${prefix}.result.entries.0.message}`),
      "component-task-one-1",
      background,
    ),
  );
  assert.throws(() =>
    validateServiceResultNote(
      {
        ...note(`{${prefix}.job.label}`),
        rules: [{ action: { kind: "continue" } }],
      },
      "component-task-one-1",
      background,
    ),
  );
});
