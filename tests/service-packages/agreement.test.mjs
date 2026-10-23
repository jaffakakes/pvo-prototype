import assert from "node:assert/strict";
import test from "node:test";
import {
  parseServiceAgreement,
  parseServiceInvocation,
  parseServiceReply,
  serializeServiceAgreement,
} from "../../packages/pvo-assistant/services/index.js";
import {
  dinnerAgreement,
  equipmentAgreement,
  field,
  integer,
  now,
  record,
  string,
} from "./fixtures.mjs";

test("one agreement contract describes dinner capacity and equipment overlap cases without feature switches", () => {
  for (const agreement of [dinnerAgreement(), equipmentAgreement()]) {
    const parsed = parseServiceAgreement(agreement);
    assert.deepEqual(parsed, agreement);
    assert.notEqual(parsed, agreement);
    for (const scenario of parsed.cases) {
      let state = scenario.initialState;
      for (const { operation, input, now, expected } of scenario.steps) {
        const call = parseServiceInvocation(parsed, {
          operation,
          input,
          now,
          state,
        });
        assert.deepEqual(parseServiceReply(parsed, call, expected), expected);
        state = expected.state;
      }
    }
  }
});

test("operation rules reject malformed inputs, unknown actions, wrong results and read-only mutations", () => {
  const agreement = dinnerAgreement();
  const call = {
    operation: "join",
    input: { name: "Alice" },
    state: agreement.state.initial,
    now,
  };
  for (const change of [
    { operation: "deleteEverything" },
    { input: { name: 3 } },
    { input: { name: "Alice", secret: "hidden" } },
    { input: {} },
    { input: { name: "é".repeat(65) } },
    { state: { capacity: 101, guests: [] } },
    { state: { capacity: 1.5, guests: [] } },
    { now: Infinity },
    { now: -1 },
    { credentials: {} },
  ])
    assert.throws(() =>
      parseServiceInvocation(agreement, { ...call, ...change }),
    );
  assert.throws(() =>
    parseServiceReply(agreement, call, {
      result: "invented",
      state: call.state,
    }),
  );
  assert.throws(() =>
    parseServiceReply(agreement, call, {
      result: "accepted",
      state: call.state,
      passed: true,
    }),
  );
  const read = { ...call, operation: "guests", input: null };
  assert.throws(
    () =>
      parseServiceReply(agreement, read, {
        result: [],
        state: { capacity: 2, guests: [] },
      }),
    /read operation/,
  );
  assert.deepEqual(
    parseServiceReply(agreement, read, {
      result: [],
      state: { guests: [], capacity: 1 },
    }),
    { result: [], state: { guests: [], capacity: 1 } },
  );
});

test("behavior cases must be structurally valid, cover every action and preserve read state", () => {
  const mutations = [
    (a) => a.cases.splice(0),
    (a) => a.cases[0].steps.splice(3),
    (a) => a.cases.push(structuredClone(a.cases[0])),
    (a) => a.operations.push(structuredClone(a.operations[0])),
    (a) => (a.cases[0].steps[0].input.name = 1),
    (a) => (a.cases[0].steps[0].expected.result = "success"),
    (a) =>
      (a.cases[0].steps[3].expected.state = { capacity: 2, guests: ["Alice"] }),
    (a) => (a.cases[0].steps[0].operation = "missing"),
    (a) => (a.operations[0].audience = "admin"),
    (a) => (a.operations[0].access = "everything"),
    (a) => (a.operations[0].name = "constructor"),
    (a) => (a.cases[0].steps = []),
    (a) => (a.cases[0].initialState.guests = Array(33).fill("A")),
  ];
  for (const mutate of mutations) {
    const agreement = structuredClone(dinnerAgreement());
    mutate(agreement);
    assert.throws(() => parseServiceAgreement(agreement));
  }
});

test("closed schema bounds reject recursion, excessive shape, executable fields and invalid numeric ranges", () => {
  const invalid = [
    { type: "string", maxBytes: 8193 },
    { type: "string", maxBytes: 1, pattern: ".*" },
    { type: "object", fields: [field("__proto__", string())] },
    record(field("same", string()), field("same", string())),
    { type: "number", minimum: 2, maximum: 1 },
    { type: "integer", minimum: 0, maximum: 1.5 },
    { type: "number", minimum: -Infinity, maximum: Infinity },
    { type: "enum", values: [] },
    { type: "enum", values: ["a", "a"] },
    { type: "array", maxItems: 129, items: string() },
    { type: "reference", target: "https://example.invalid/schema" },
  ];
  let deep = string();
  for (let i = 0; i < 10; i++)
    deep = { type: "array", maxItems: 1, items: deep };
  invalid.push(deep);
  const cyclic = { type: "array", maxItems: 1 };
  cyclic.items = cyclic;
  invalid.push(cyclic);
  const wide = record(
    ...Array.from({ length: 24 }, (_, i) =>
      field(
        `f${i}`,
        record(
          ...Array.from({ length: 24 }, (_, j) => field(`v${j}`, integer())),
        ),
      ),
    ),
  );
  invalid.push(wide);
  for (const schema of invalid) {
    const agreement = dinnerAgreement();
    agreement.operations[0].input = schema;
    assert.throws(() => parseServiceAgreement(agreement));
  }
});

test("strict JSON boundary rejects accessors, missing/extra symbols, inherited fields and sparse arrays", () => {
  let reads = 0;
  const agreement = dinnerAgreement();
  const call = {
    operation: "join",
    input: { name: "A" },
    state: agreement.state.initial,
    now,
  };
  const accessor = {};
  Object.defineProperty(accessor, "name", {
    enumerable: true,
    get() {
      reads++;
      return "A";
    },
  });
  for (const input of [
    accessor,
    Object.create({ name: "A" }),
    { name: "A", [Symbol("hidden")]: true },
  ])
    assert.throws(() => parseServiceInvocation(agreement, { ...call, input }));
  assert.equal(reads, 0);
  assert.throws(() =>
    parseServiceInvocation(agreement, {
      ...call,
      state: { capacity: 1, guests: Array(1) },
    }),
  );
  const schemaAccessor = {};
  Object.defineProperty(schemaAccessor, "type", {
    enumerable: true,
    get() {
      reads++;
      return "null";
    },
  });
  agreement.operations[0].input = schemaAccessor;
  assert.throws(() => parseServiceAgreement(agreement));
  assert.equal(reads, 0);
});

test("canonical agreement bytes are stable across object-key order and change with requested behavior", () => {
  const agreement = dinnerAgreement();
  const reorder = (value) =>
    Array.isArray(value)
      ? value.map(reorder)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .reverse()
              .map(([k, v]) => [k, reorder(v)]),
          )
        : value;
  assert.equal(
    serializeServiceAgreement(agreement),
    serializeServiceAgreement(reorder(agreement)),
  );
  const independent = parseServiceAgreement(agreement);
  independent.description = "Changed request.";
  assert.notEqual(
    serializeServiceAgreement(agreement),
    serializeServiceAgreement(independent),
  );
  independent.state.initial.capacity = 2;
  assert.equal(agreement.state.initial.capacity, 1);
});
