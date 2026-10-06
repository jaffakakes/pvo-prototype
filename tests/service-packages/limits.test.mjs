import assert from "node:assert/strict";
import test from "node:test";
import {
  parseServiceAgreement,
  parseServiceInvocation,
  parseServiceReply,
} from "../../packages/pvo-assistant/services/index.js";
import { dinnerAgreement, field, now, record, string } from "./fixtures.mjs";

function echoAgreement(schema, input) {
  return {
    description: "Return the submitted value.",
    state: { schema: { type: "null" }, initial: null },
    operations: [
      {
        name: "echo",
        description: "Echo the value.",
        audience: "public",
        access: "read",
        input: schema,
        result: schema,
      },
    ],
    cases: [
      {
        id: "echo",
        description: "Return the value unchanged.",
        initialState: null,
        steps: [
          {
            operation: "echo",
            input,
            now,
            expected: { result: input, state: null },
          },
        ],
      },
    ],
  };
}

test("all data kinds validate without coercion and finite fractional numbers remain supported", () => {
  const samples = [
    [{ type: "null" }, null, undefined],
    [{ type: "boolean" }, true, "true"],
    [{ type: "number", minimum: -2, maximum: 2 }, 1.25, NaN],
    [record(), {}, null],
    [
      { type: "array", maxItems: 2, items: { type: "boolean" } },
      [true, false],
      [true, 0],
    ],
  ];
  for (const [schema, input, invalid] of samples) {
    const agreement = echoAgreement(schema, input);
    assert.doesNotThrow(() => parseServiceAgreement(agreement));
    const invocation = { operation: "echo", input, state: null, now };
    assert.throws(() =>
      parseServiceInvocation(agreement, { ...invocation, input: invalid }),
    );
    assert.throws(() =>
      parseServiceReply(agreement, invocation, {
        result: invalid,
        state: null,
      }),
    );
  }
});

test("input and result limits count JSON escaping/container overhead and reject nested expansion early", () => {
  const agreement = echoAgreement(string(8192), "");
  const invocation = {
    operation: "echo",
    input: "x".repeat(8190),
    state: null,
    now,
  };
  assert.doesNotThrow(() => parseServiceInvocation(agreement, invocation));
  assert.throws(
    () =>
      parseServiceInvocation(agreement, {
        ...invocation,
        input: "x".repeat(8191),
      }),
    /total byte limit/,
  );
  assert.throws(
    () =>
      parseServiceInvocation(agreement, {
        ...invocation,
        input: "\n".repeat(4096),
      }),
    /total byte limit/,
  );
  assert.throws(
    () =>
      parseServiceReply(agreement, invocation, {
        result: "x".repeat(8191),
        state: null,
      }),
    /total byte limit/,
  );
  const nestedSchema = {
    type: "array",
    maxItems: 128,
    items: { type: "array", maxItems: 128, items: string(8192) },
  };
  const nested = echoAgreement(nestedSchema, []);
  const expanded = Array(128).fill(Array(128).fill("x".repeat(8190)));
  assert.throws(
    () => parseServiceInvocation(nested, { ...invocation, input: expanded }),
    /total byte limit/,
  );
  const objects = echoAgreement(record(field("value", string(8192))), {
    value: "",
  });
  assert.throws(
    () =>
      parseServiceInvocation(objects, {
        ...invocation,
        input: { value: "x".repeat(8190) },
      }),
    /total byte limit/,
  );
});

test("state, agreement and behavior-step limits are independent of valid individual cases", () => {
  const agreement = echoAgreement({ type: "null" }, null);
  agreement.state = {
    schema: { type: "array", maxItems: 128, items: string(8192) },
    initial: [],
  };
  agreement.cases[0].initialState = [];
  agreement.cases[0].steps[0].expected.state = [];
  const state = Array(6).fill("x".repeat(8192));
  assert.throws(
    () =>
      parseServiceInvocation(agreement, {
        operation: "echo",
        input: null,
        state,
        now,
      }),
    /total byte limit/,
  );
  const largeState = Array(5).fill("x".repeat(8192));
  const manyBytes = structuredClone(agreement);
  manyBytes.cases = Array.from({ length: 4 }, (_, i) => ({
    ...structuredClone(agreement.cases[0]),
    id: `case${i}`,
    initialState: largeState,
    steps: [
      {
        operation: "echo",
        input: null,
        now,
        expected: { result: null, state: largeState },
      },
    ],
  }));
  assert.throws(() => parseServiceAgreement(manyBytes), /total byte limit/);
  const manySteps = dinnerAgreement();
  manySteps.cases = Array.from({ length: 16 }, (_, i) => ({
    ...structuredClone(manySteps.cases[0]),
    id: `case${i}`,
  }));
  assert.doesNotThrow(() => parseServiceAgreement(manySteps));
  manySteps.cases[0].steps.push(
    structuredClone(manySteps.cases[0].steps.at(-1)),
  );
  assert.throws(() => parseServiceAgreement(manySteps), /total limit/);
  const perCase = dinnerAgreement();
  perCase.cases[0].steps.push(...Array(5).fill(perCase.cases[0].steps.at(-1)));
  assert.throws(() => parseServiceAgreement(perCase), /item limit/);
});
