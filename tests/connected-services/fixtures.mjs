import {
  field,
  record,
  string,
  integer,
  now,
  sourcePackage,
} from "../service-packages/fixtures.mjs";
export { now, field, record, string, integer };
export function readAdapter() {
  return {
    name: "readIssue",
    description: "Read one issue from the saved repository.",
    provider: "github",
    method: "GET",
    path: ["issues", { input: "number" }],
    query: [],
    input: record(
      field("number", { type: "integer", minimum: 1, maximum: 1000000 }),
    ),
    result: record(field("title", string(256))),
    responsePath: [],
    permission: "issues:read",
    completion: "synchronous",
    documentation: "https://docs.github.com/en/rest/issues/issues#get-an-issue",
  };
}
export function writeAdapter() {
  return {
    ...readAdapter(),
    name: "createIssue",
    description: "Create one issue with a recoverable request marker.",
    method: "POST",
    path: ["issues"],
    input: record(field("title", string(256)), field("body", string(4096))),
    result: record(field("number", integer(1000000))),
    permission: "issues:write",
    documentation:
      "https://docs.github.com/en/rest/issues/issues#create-an-issue",
  };
}
export function connectedAgreement() {
  return {
    description:
      "Show the title of a requested issue from the creator's connected repository.",
    state: { schema: { type: "null" }, initial: null },
    operations: [
      {
        name: "lookup",
        description: "Read a requested issue title.",
        audience: "public",
        access: "read",
        input: readAdapter().input,
        result: string(256),
      },
    ],
    connections: [
      {
        name: "issue",
        connectionId: "connection-one",
        operations: ["lookup"],
        adapter: readAdapter(),
        examples: [
          { input: { number: 7 }, result: { title: "Saved example" } },
        ],
      },
    ],
    cases: [
      {
        id: "lookup",
        description: "Display the checked issue title.",
        initialState: null,
        steps: [
          {
            operation: "lookup",
            input: { number: 7 },
            now,
            requests: [{ connection: "issue", input: { number: 7 } }],
            expected: { result: "Saved example", state: null },
          },
        ],
      },
    ],
  };
}
export function connectedSource(agreementDigest) {
  const source = sourcePackage(agreementDigest);
  source.files[0].content = `export function execute({ input, state, connectionResults = [] }) {
    if (!connectionResults.length) return { request: { connection: "issue", input } };
    return { result: connectionResults[0].result.title, state };
  }`;
  return source;
}

export function writeFixture() {
  const agreement = connectedAgreement(),
    adapter = writeAdapter();
  const input = { title: "Requested action", body: "Controlled test" };
  agreement.description =
    "Recover a saved outside action without sending it twice.";
  agreement.operations[0] = {
    ...agreement.operations[0],
    access: "write",
    input: adapter.input,
    result: adapter.result.fields[0].schema,
  };
  agreement.connections[0] = {
    ...agreement.connections[0],
    adapter,
    examples: [{ input, result: { number: 42 } }],
  };
  agreement.cases[0].steps[0] = {
    ...agreement.cases[0].steps[0],
    input,
    requests: [{ connection: "issue", input }],
    expected: { result: 42, state: null },
  };
  return {
    agreement,
    input,
    source: connectedSource().files[0].content.replace(
      ".result.title",
      ".result.number",
    ),
  };
}
