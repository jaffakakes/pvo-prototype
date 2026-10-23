import { parseServiceAgreement } from "../../../packages/pvo-assistant/services/index.js";

const field = (name, schema) => ({
  name,
  description: `Value of ${name}.`,
  schema,
});
const object = (...fields) => ({ type: "object", fields });
const string = (maxBytes = 128) => ({ type: "string", maxBytes });
const integer = (maximum = 9999999999999) => ({
  type: "integer",
  minimum: 0,
  maximum,
});
const array = (items, maxItems = 12) => ({ type: "array", maxItems, items });
const enumeration = (...values) => ({ type: "enum", values });
const operation = (name, access, input, result, description) => ({
  name,
  description,
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
const scenario = (id, initialState, steps) => ({
  id,
  description: `Verify ${id}.`,
  initialState,
  steps,
});

function guestbook() {
  const entry = object(
    field("name", string(80)),
    field("message", string(1024)),
    field("createdAt", integer()),
  );
  const initial = { entries: [] };
  const first = { name: "Ari", message: "Hello", createdAt: 100 };
  const one = { entries: [first] };
  const agreement = {
    description:
      "Shared guestbook. Trim names/messages; reject blank values without changing state. Append full entries oldest first using supplied now. Keep at most twelve entries; reject additions when full. submit returns status saved, invalid or full and message 'Saved, NAME.', 'Enter a name and message.' or 'Guestbook full.'. latest returns at most three newest entries, newest first, without changing state. No email or network.",
    state: { schema: object(field("entries", array(entry))), initial },
    operations: [
      operation(
        "submit",
        "write",
        object(field("name", string(80)), field("message", string(1024))),
        object(
          field("status", enumeration("saved", "invalid", "full")),
          field("message", string(512)),
        ),
        "Save a guestbook entry under the exact description rules.",
      ),
      operation(
        "latest",
        "read",
        { type: "null" },
        array(entry, 3),
        "Read the latest three entries newest first.",
      ),
    ],
    cases: [
      scenario("save-and-read", initial, [
        step("submit", { name: " Ari ", message: " Hello " }, one, {
          status: "saved",
          message: "Saved, Ari.",
        }),
        step("latest", null, one, [first]),
      ]),
    ],
  };
  const entries = [0, 1, 2, 3].map((i) => ({
    name: `Visitor ${i}`,
    message: i === 3 ? "🙂".repeat(200) : `Note ${i}`,
    createdAt: 101 + i,
  }));
  const full = {
    entries: Array.from({ length: 12 }, (_, i) => ({
      name: `Person ${i}`,
      message: "Retained",
      createdAt: i,
    })),
  };
  return {
    id: "guestbook",
    request:
      "Build the backend for a shared guestbook component. Save full names and messages, show the latest three and give clear confirmations. Handle blank input, Unicode and a full guestbook. Do not send messages or contact outside services.",
    agreement,
    holdouts: [
      scenario("blank-rejected", initial, [
        step("submit", { name: " \t ", message: "Hello" }, initial, {
          status: "invalid",
          message: "Enter a name and message.",
        }),
      ]),
      scenario("unicode-and-newest-three", initial, [
        ...entries.map((entry, i) =>
          step(
            "submit",
            { name: entry.name, message: entry.message },
            { entries: entries.slice(0, i + 1) },
            { status: "saved", message: `Saved, ${entry.name}.` },
            entry.createdAt,
          ),
        ),
        step("latest", null, { entries }, entries.slice(-3).reverse()),
      ]),
      scenario("full-preserves-data", full, [
        step("submit", { name: "Extra", message: "Should not save" }, full, {
          status: "full",
          message: "Guestbook full.",
        }),
      ]),
    ],
  };
}

function booking() {
  const initial = { capacity: 1, guests: [] },
    one = { capacity: 1, guests: ["Ari"] };
  const agreement = {
    description:
      "Limited-space booking list. Trim names; blank names return invalid. Names are case-sensitive identities. join returns already_joined before checking capacity, full when no room, otherwise appends and returns accepted. cancel removes a matching trimmed name and returns removed, otherwise not_joined. guests returns names in retained order without changing state. No external bookings or messages.",
    state: {
      schema: object(
        field("capacity", integer(12)),
        field("guests", array(string(80))),
      ),
      initial,
    },
    operations: [
      operation(
        "join",
        "write",
        object(field("name", string(80))),
        enumeration("accepted", "already_joined", "full", "invalid"),
        "Join under capacity and identity rules.",
      ),
      operation(
        "cancel",
        "write",
        object(field("name", string(80))),
        enumeration("removed", "not_joined", "invalid"),
        "Remove an existing booking.",
      ),
      operation(
        "guests",
        "read",
        { type: "null" },
        array(string(80)),
        "Read the retained guest names.",
      ),
    ],
    cases: [
      scenario("last-place-and-cancel", initial, [
        step("join", { name: "Ari" }, one, "accepted"),
        step("join", { name: "Bo" }, one, "full"),
        step("cancel", { name: "Ari" }, initial, "removed"),
        step("guests", null, initial, []),
      ]),
    ],
  };
  const two = { capacity: 2, guests: ["Zoë", "Lee"] };
  const after = { capacity: 2, guests: ["Lee"] };
  return {
    id: "booking",
    request:
      "Build the backend for friends to take limited spaces and cancel their booking. Repeated acceptance must not use another place; cancelling frees a place. Keep the guest list after a restart. No restaurant connection or outside messages.",
    agreement,
    holdouts: [
      scenario("duplicate-before-full", two, [
        step("join", { name: " Zoë " }, two, "already_joined"),
        step("cancel", { name: "Zoë" }, after, "removed"),
        step(
          "join",
          { name: "Bo" },
          { capacity: 2, guests: ["Lee", "Bo"] },
          "accepted",
        ),
      ]),
      scenario("invalid-and-absent", two, [
        step("join", { name: " \n " }, two, "invalid"),
        step("cancel", { name: "Absent" }, two, "not_joined"),
        step("guests", null, two, two.guests),
      ]),
      scenario("zero-capacity", { capacity: 0, guests: [] }, [
        step("join", { name: "First" }, { capacity: 0, guests: [] }, "full"),
      ]),
    ],
  };
}

function poll() {
  const vote = object(
    field("voter", string(80)),
    field("choice", enumeration("tea", "coffee")),
  );
  const initial = { closesAt: 200, votes: [] };
  const first = { voter: "Ari", choice: "tea" },
    changed = { voter: "Ari", choice: "coffee" };
  const agreement = {
    description:
      "Two-choice poll. The host supplies now. At now >= closesAt, vote returns closed and does not change state. Before closing, trim voter; blank returns invalid. A new case-sensitive voter appends a vote and returns recorded. An existing voter changing choice replaces it in place and returns changed; same choice returns unchanged. tally returns counts for tea and coffee and closed=(now>=closesAt), without changing state. No network or actual timers.",
    state: {
      schema: object(
        field("closesAt", integer()),
        field("votes", array(vote, 32)),
      ),
      initial,
    },
    operations: [
      operation(
        "vote",
        "write",
        vote,
        enumeration("recorded", "changed", "unchanged", "closed", "invalid"),
        "Save or update one vote while the poll is open.",
      ),
      operation(
        "tally",
        "read",
        { type: "null" },
        object(
          field("tea", integer(32)),
          field("coffee", integer(32)),
          field("closed", { type: "boolean" }),
        ),
        "Count current votes and report the deadline state.",
      ),
    ],
    cases: [
      scenario("record-update-tally", initial, [
        step("vote", first, { closesAt: 200, votes: [first] }, "recorded"),
        step("vote", changed, { closesAt: 200, votes: [changed] }, "changed"),
        step(
          "tally",
          null,
          { closesAt: 200, votes: [changed] },
          { tea: 0, coffee: 1, closed: false },
        ),
      ]),
    ],
  };
  const retained = {
    closesAt: 500,
    votes: [
      { voter: "Zoë", choice: "tea" },
      { voter: "Bo", choice: "coffee" },
    ],
  };
  return {
    id: "poll",
    request:
      "Build the backend for a tea-or-coffee poll that closes at a set time. Each person gets one vote and can change it before closing. Show truthful totals after reopening and reject late votes. Use the time supplied by Restyle.",
    agreement,
    holdouts: [
      scenario("deadline-boundary", retained, [
        step("vote", { voter: "Late", choice: "tea" }, retained, "closed", 500),
        step("tally", null, retained, { tea: 1, coffee: 1, closed: true }, 501),
      ]),
      scenario("trim-duplicate-and-order", retained, [
        step(
          "vote",
          { voter: " Zoë ", choice: "tea" },
          retained,
          "unchanged",
          499,
        ),
        step(
          "vote",
          { voter: "Bo", choice: "tea" },
          {
            closesAt: 500,
            votes: [
              { voter: "Zoë", choice: "tea" },
              { voter: "Bo", choice: "tea" },
            ],
          },
          "changed",
          499,
        ),
      ]),
      scenario("blank-voter", initial, [
        step("vote", { voter: "  ", choice: "tea" }, initial, "invalid", 199),
      ]),
    ],
  };
}

export function comparisonScenarios() {
  return [guestbook(), booking(), poll()].map((value) => {
    parseServiceAgreement(value.agreement);
    parseServiceAgreement({ ...value.agreement, cases: value.holdouts });
    return value;
  });
}
