import { parseServiceAgreement } from "../../../packages/pvo-assistant/services/index.js";

const field = (name, schema) => ({
  name,
  schema,
  description: `Value of ${name}.`,
});
const object = (...fields) => ({ type: "object", fields });
const string = { type: "string", maxBytes: 80 };
const integer = (maximum) => ({ type: "integer", minimum: 0, maximum });
const array = (items, maxItems) => ({ type: "array", items, maxItems });
const enumeration = (...values) => ({ type: "enum", values });
const operation = (name, access, input, result) => ({
  name,
  description: `Perform ${name} under the agreement rules.`,
  audience: "public",
  access,
  input,
  result,
});
const step = (operation, input, state, result, now = 100) => ({
  operation,
  input,
  now,
  expected: { state, result },
});
const example = (id, initialState, steps) => ({
  id,
  description: `Verify ${id}.`,
  initialState,
  steps,
});

function inventory() {
  const initial = [
    { id: "pen", quantity: 5 },
    { id: "book", quantity: 2 },
  ];
  const after = [
    { id: "pen", quantity: 3 },
    { id: "book", quantity: 2 },
  ];
  const item = object(field("id", string), field("quantity", integer(1000)));
  const agreement = {
    description:
      "Atomic inventory withdrawal. State is an ordered list of unique case-sensitive item IDs and quantities. withdraw accepts an array of requests. Empty requests, blank trimmed IDs, zero quantities or unknown IDs return invalid with no change. Trim request IDs and combine repeated IDs before checking stock. Any combined amount above available stock returns insufficient with no change to any item. Otherwise subtract all amounts together and return accepted. Preserve item order and zero-stock entries. stock reads the whole retained inventory without mutation. No external services.",
    state: { schema: array(item, 10), initial },
    operations: [
      operation(
        "withdraw",
        "write",
        array(item, 5),
        enumeration("accepted", "invalid", "insufficient"),
      ),
      operation("stock", "read", { type: "null" }, array(item, 10)),
    ],
    cases: [
      example("withdraw-and-read", initial, [
        step("withdraw", [{ id: " pen ", quantity: 2 }], after, "accepted"),
        step("stock", null, after, after),
      ]),
    ],
  };
  const unicode = [
    { id: "筆", quantity: 7 },
    { id: "book", quantity: 1 },
  ];
  const emptyFirst = [
    { id: "筆", quantity: 0 },
    { id: "book", quantity: 1 },
  ];
  return {
    id: "H01",
    family: "build",
    request:
      "Build the agreed atomic inventory withdrawal. A basket is accepted entirely or leaves all stock unchanged. Combine duplicate item requests, validate every line and preserve inventory order. Expose the stock read operation. Use only Restyle storage.",
    agreement,
    holdouts: [
      example("duplicate-total-exceeds-stock", initial, [
        step(
          "withdraw",
          [
            { id: "pen", quantity: 3 },
            { id: " pen ", quantity: 3 },
          ],
          initial,
          "insufficient",
        ),
        step("stock", null, initial, initial),
      ]),
      example("later-invalid-does-not-partially-write", initial, [
        step(
          "withdraw",
          [
            { id: "pen", quantity: 1 },
            { id: "missing", quantity: 1 },
          ],
          initial,
          "invalid",
        ),
        step("withdraw", [], initial, "invalid"),
        step("withdraw", [{ id: "pen", quantity: 0 }], initial, "invalid"),
      ]),
      example("unicode-and-exact-exhaustion", unicode, [
        step(
          "withdraw",
          [
            { id: " 筆 ", quantity: 2 },
            { id: "筆", quantity: 5 },
          ],
          emptyFirst,
          "accepted",
        ),
        step(
          "withdraw",
          [{ id: "筆", quantity: 1 }],
          emptyFirst,
          "insufficient",
        ),
        step("stock", null, emptyFirst, emptyFirst),
      ]),
    ],
  };
}

function invitations() {
  const entry = object(
    field("code", string),
    field("expiresAt", integer(999999)),
    field("used", { type: "boolean" }),
  );
  const initial = [{ code: "Invite-A", expiresAt: 200, used: false }];
  const used = [{ ...initial[0], used: true }];
  const agreement = {
    description:
      "One-use event invitations. State is an ordered array of unique case-sensitive codes, expiresAt and used. Trim the supplied code. Unknown or blank codes return unknown. A known used code returns used even after expiry. Otherwise now >= expiresAt returns expired. Otherwise status returns available without changes, while redeem marks exactly that entry used and returns accepted. Never remove, reorder or alter any other entry. Use only the host-supplied now, no wall clock or timers. No network or external admission system.",
    state: { schema: array(entry, 10), initial },
    operations: [
      operation(
        "redeem",
        "write",
        string,
        enumeration("unknown", "used", "expired", "accepted"),
      ),
      operation(
        "status",
        "read",
        string,
        enumeration("unknown", "used", "expired", "available"),
      ),
    ],
    cases: [
      example("inspect-redeem-replay", initial, [
        step("status", " Invite-A ", initial, "available"),
        step("redeem", "Invite-A", used, "accepted"),
        step("redeem", "Invite-A", used, "used"),
      ]),
    ],
  };
  const other = [
    { code: "Ω-7", expiresAt: 500, used: false },
    { code: "Other", expiresAt: 800, used: false },
  ];
  const changed = [{ ...other[0], used: true }, other[1]];
  return {
    id: "H02",
    family: "build",
    request:
      "Build the agreed single-use event invitation check and redemption. Use the supplied time, preserve all other invitations, and keep redeemed invitations recognisable after expiry. No email or outside effects.",
    agreement,
    holdouts: [
      example("exact-expiry-boundary", initial, [
        step("status", "Invite-A", initial, "available", 199),
        step("redeem", "Invite-A", initial, "expired", 200),
        step("status", "Invite-A", initial, "expired", 201),
      ]),
      example("trim-case-unicode-and-retention", other, [
        step("redeem", " Ω-7 ", changed, "accepted", 499),
        step("status", "Ω-7", changed, "used", 900),
        step("redeem", "Other", changed, "expired", 800),
        step("status", "other", changed, "unknown", 100),
        step("redeem", "  ", changed, "unknown", 100),
      ]),
    ],
  };
}

export function harnessScenarios() {
  return [inventory(), invitations()].map((scenario) => {
    parseServiceAgreement(scenario.agreement);
    parseServiceAgreement({ ...scenario.agreement, cases: scenario.holdouts });
    return scenario;
  });
}
