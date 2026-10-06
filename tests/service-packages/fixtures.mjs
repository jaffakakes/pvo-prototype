export const field = (name, schema) => ({
  name,
  description: `Value of ${name}.`,
  schema,
});
export const record = (...fields) => ({ type: "object", fields });
export const string = (maxBytes = 128) => ({ type: "string", maxBytes });
export const integer = (maximum = 100) => ({
  type: "integer",
  minimum: 0,
  maximum,
});
export const now = 1791229983000;

export function dinnerAgreement() {
  const state = record(
    field("capacity", integer()),
    field("guests", {
      type: "array",
      maxItems: 32,
      items: string(),
    }),
  );
  const initial = { capacity: 1, guests: [] };
  const accepted = { capacity: 1, guests: ["Alice"] };
  return {
    description:
      "Let friends accept a dinner invitation without exceeding capacity.",
    state: { schema: state, initial },
    operations: [
      {
        name: "join",
        description: "Accept an invitation if there is space.",
        audience: "public",
        access: "write",
        input: record(field("name", string())),
        result: {
          type: "enum",
          values: ["accepted", "full", "already_joined"],
        },
      },
      {
        name: "guests",
        description: "Allow the creator to inspect accepted invitations.",
        audience: "creator",
        access: "read",
        input: { type: "null" },
        result: { type: "array", maxItems: 32, items: string() },
      },
    ],
    cases: [
      {
        id: "capacity",
        description:
          "The last place is accepted; a different next guest is rejected.",
        initialState: initial,
        steps: [
          {
            operation: "join",
            input: { name: "Alice" },
            now,
            expected: { result: "accepted", state: accepted },
          },
          {
            operation: "join",
            input: { name: "Bob" },
            now,
            expected: { result: "full", state: accepted },
          },
          {
            operation: "join",
            input: { name: "Alice" },
            now,
            expected: { result: "already_joined", state: accepted },
          },
          {
            operation: "guests",
            input: null,
            now,
            expected: { result: ["Alice"], state: accepted },
          },
        ],
      },
    ],
  };
}

export function equipmentAgreement() {
  const booking = record(
    field("item", string()),
    field("start", string(10)),
    field("end", string(10)),
  );
  const empty = { bookings: [] };
  const first = { item: "camera", start: "2026-10-06", end: "2026-10-08" };
  const adjacent = { item: "camera", start: "2026-10-08", end: "2026-10-09" };
  return {
    description:
      "Request equipment for a date range; reject overlaps on the same item. End dates are exclusive.",
    state: {
      schema: record(
        field("bookings", { type: "array", maxItems: 32, items: booking }),
      ),
      initial: empty,
    },
    operations: [
      {
        name: "reserve",
        description: "Reserve equipment for a valid non-overlapping period.",
        audience: "public",
        access: "write",
        input: booking,
        result: {
          type: "enum",
          values: ["reserved", "overlap", "invalid_dates"],
        },
      },
    ],
    cases: [
      {
        id: "overlap",
        description:
          "An overlap fails while a following adjacent range succeeds.",
        initialState: empty,
        steps: [
          {
            operation: "reserve",
            input: first,
            now,
            expected: { result: "reserved", state: { bookings: [first] } },
          },
          {
            operation: "reserve",
            input: { item: "camera", start: "2026-10-07", end: "2026-10-09" },
            now,
            expected: { result: "overlap", state: { bookings: [first] } },
          },
          {
            operation: "reserve",
            input: adjacent,
            now,
            expected: {
              result: "reserved",
              state: { bookings: [first, adjacent] },
            },
          },
        ],
      },
    ],
  };
}

export const sourcePackage = (agreementDigest = "a".repeat(64)) => ({
  agreementDigest,
  runtime: "cloudflare-workers-esm",
  entrypoint: "src/service.mjs",
  dependencies: [],
  files: [
    {
      path: "src/service.mjs",
      content:
        "export function execute({ state }) { return { result: null, state }; }\n",
    },
    {
      path: "tests/service.test.mjs",
      content: "import test from 'node:test';\ntest('example', () => {});\n",
    },
  ],
  tests: ["tests/service.test.mjs"],
});
