import { parseServiceAgreement } from "../../../packages/pvo-assistant/services/index.js";
import { references } from "./pressure-references.mjs";
import { connectedAgreement } from "../../../tests/connected-services/fixtures.mjs";

const field = (name, schema) => ({ name, schema, description: name });
const object = (...fields) => ({ type: "object", fields });
const integer = (maximum) => ({ type: "integer", minimum: 0, maximum });
const enumeration = (...values) => ({ type: "enum", values });
const array = (items, maxItems) => ({ type: "array", items, maxItems });
const text = { type: "string", maxBytes: 80 };
const nil = { type: "null" };
const operation = (name, access, input, result) => ({
  name,
  access,
  input,
  result,
  audience: "public",
  description: `Follow the declared ${name} rules.`,
});

function example(id, initialState, inputs, reference) {
  let state = structuredClone(initialState);
  return {
    id,
    description: id,
    initialState,
    steps: inputs.map(([operation, input]) => {
      const expected = reference({ operation, input, state, now: 100 });
      state = structuredClone(expected.state);
      return { operation, input, now: 100, expected };
    }),
  };
}

/** Only agreement examples reach the builder. sealedCases are scored after completion, without repair feedback. */
export function pressureBuilds() {
  const waitingState = object(
    field("capacity", integer(8)),
    field("active", array(text, 8)),
    field("waiting", array(text, 8)),
  );
  const definitions = [
    {
      id: "B1",
      description:
        "Synthetic colour quiz. Input is up to three answers: red, blue or skip. Count each non-skip vote. Return winner red or blue for the larger count, or tie for equal counts including all skips/empty. answered counts non-skip answers. Never mutate null state. All facts are supplied; no video fact inference.",
      state: { schema: nil, initial: null },
      operations: [
        operation(
          "score",
          "read",
          object(
            field("answers", array(enumeration("red", "blue", "skip"), 3)),
          ),
          object(
            field("winner", enumeration("red", "blue", "tie")),
            field("answered", integer(3)),
          ),
        ),
      ],
      examples: [["score", { answers: ["red", "red", "blue"] }]],
      checks: [
        [],
        ["skip"],
        ["red", "blue"],
        ["blue", "red", "blue"],
        ["skip", "skip", "skip"],
        ["red", "skip", "red"],
        ["blue", "skip", "red"],
        ["blue", "blue", "skip"],
      ].map((answers) => [["score", { answers }]]),
    },
    {
      id: "B2",
      description:
        "Choose only from A(price 10, tags light), B(price 15, tags light and quiet), C(price 15, tag quiet). Exclude prices above budget. Rank by number of DISTINCT requested tags matched, then lower price, then lexicographically smaller ID. No affordable product returns none. Empty preferences choose cheapest affordable. Never invent a product/tag or mutate null state.",
      state: { schema: nil, initial: null },
      operations: [
        operation(
          "choose",
          "read",
          object(
            field("budget", integer(100)),
            field("preferences", array(enumeration("light", "quiet"), 4)),
          ),
          enumeration("A", "B", "C", "none"),
        ),
      ],
      examples: [["choose", { budget: 20, preferences: ["light", "quiet"] }]],
      checks: [0, 9, 10, 14, 15, 100].map((budget) =>
        [[], ["quiet"], ["light", "light", "quiet"]].map((preferences) => [
          "choose",
          { budget, preferences },
        ]),
      ),
    },
    {
      id: "B3",
      description:
        "Workshop waitlist, capacity 0..8; active/waiting ordered case-sensitive names. Trim names; blank => invalid, unchanged. join checks duplicate in either list BEFORE capacity; otherwise append active if room, else waiting if fewer than eight waiting, else full. cancel removes matching active and promotes oldest waiting to end of active; cancelling a waiting name removes only it. Missing cancel => absent. Other results accepted, waiting, duplicate, cancelled. status reads complete state unchanged. Preserve all other fields/order. No external bookings.",
      state: {
        schema: waitingState,
        initial: { capacity: 1, active: [], waiting: [] },
      },
      operations: [
        operation(
          "join",
          "write",
          object(field("name", text)),
          enumeration("accepted", "waiting", "duplicate", "full", "invalid"),
        ),
        operation(
          "cancel",
          "write",
          object(field("name", text)),
          enumeration("cancelled", "absent", "invalid"),
        ),
        operation("status", "read", nil, waitingState),
      ],
      examples: [
        ["join", { name: "Ari" }],
        ["join", { name: "Bo" }],
        ["cancel", { name: "Ari" }],
        ["status", null],
      ],
      checks: [
        [
          ["join", { name: " Zoë " }],
          ["join", { name: "李" }],
          ["join", { name: "Mia" }],
          ["join", { name: "李" }],
          ["cancel", { name: "Zoë" }],
          ["status", null],
        ],
        [
          ["join", { name: "A" }],
          ["join", { name: "B" }],
          ["join", { name: "C" }],
          ["cancel", { name: "B" }],
          ["cancel", { name: "A" }],
          ["status", null],
        ],
        [
          ["join", { name: " \t " }],
          ["cancel", { name: "missing" }],
          ["status", null],
        ],
        [
          ...Array.from({ length: 10 }, (_, i) => [
            "join",
            { name: `Person${i}` },
          ]),
          ["join", { name: "Person1" }],
          ["status", null],
        ],
      ],
    },
    {
      id: "B4",
      description:
        "Synthetic quote only, no charge/network. pen=125 cents, book=999 cents. Sum quantities including repeated IDs; zero and empty cart are valid. Any unknown ID returns {status:invalid,cents:0}. Quantities 0..100. discount true applies exactly 10 percent to TOTAL; round to nearest integer cent with halves upward, once at end. Otherwise exact subtotal. Return {status:quoted,cents:amount}. Preserve state exactly even for later invalid item; state records prior unrelated receipts.",
      state: { schema: array(text, 4), initial: ["retained-Ω"] },
      operations: [
        operation(
          "quote",
          "read",
          object(
            field(
              "items",
              array(
                object(field("id", text), field("quantity", integer(100))),
                4,
              ),
            ),
            field("discount", { type: "boolean" }),
          ),
          object(
            field("status", enumeration("quoted", "invalid")),
            field("cents", integer(500000)),
          ),
        ),
      ],
      examples: [
        ["quote", { items: [{ id: "book", quantity: 1 }], discount: false }],
      ],
      checks: [
        [],
        [{ id: "pen", quantity: 1 }],
        [{ id: "pen", quantity: 0 }],
        [
          { id: "pen", quantity: 100 },
          { id: "book", quantity: 100 },
        ],
        [
          { id: "pen", quantity: 1 },
          { id: "pen", quantity: 1 },
        ],
        [
          { id: "book", quantity: 1 },
          { id: "missing", quantity: 1 },
        ],
        [{ id: "筆", quantity: 1 }],
      ].map((items) =>
        [false, true].map((discount) => ["quote", { items, discount }]),
      ),
    },
  ];
  const builds = definitions.map(
    ({ id, description, state, operations, examples, checks }) => {
      const reference = references[id];
      const agreement = {
        description,
        state,
        operations,
        cases: [example("public", state.initial, examples, reference)],
      };
      const sealedCases = checks.flatMap((inputs, i) => {
        let initial = structuredClone(state.initial);
        const chunks = [];
        for (let offset = 0; offset < inputs.length; offset += 8) {
          const value = example(
            `sealed-${i + 1}-${offset}`,
            initial,
            inputs.slice(offset, offset + 8),
            reference,
          );
          initial = value.steps.at(-1).expected.state;
          chunks.push(value);
        }
        return chunks;
      });
      parseServiceAgreement(agreement);
      for (const c of sealedCases) {
        // Each validation set must cover every operation, independently of the tested sequence.
        parseServiceAgreement({ ...agreement, cases: [...agreement.cases, c] });
      }
      return {
        id,
        family: "build",
        partition: id === "B4" ? "reserved" : "diagnostic",
        capability: "supported-service",
        request: description,
        agreement,
        holdouts: [],
        sealedCases,
      };
    },
  );
  const connected = connectedAgreement();
  connected.description +=
    " Return the actual trusted title, never the example. Preserve every UTF-8 byte up to the declared maximum.";
  builds.push({
    id: "G4",
    family: "build",
    partition: "reserved",
    capability: "supported-connection",
    request: connected.description,
    agreement: connected,
    holdouts: [],
    sealedCases: ["🧾".repeat(64), "z".repeat(256), "\u2067مرحبا Ω\u2069"].map(
      (title, i) => ({
        id: `provider-${i}`,
        description: "Actual unfamiliar provider title",
        initialState: null,
        steps: [
          {
            operation: "lookup",
            input: { number: i === 0 ? 1000000 : i + 1 },
            now: 100,
            requests: [
              {
                connection: "issue",
                input: { number: i === 0 ? 1000000 : i + 1 },
              },
            ],
            expected: { state: null, result: title },
          },
        ],
      }),
    ),
  });
  return builds;
}
