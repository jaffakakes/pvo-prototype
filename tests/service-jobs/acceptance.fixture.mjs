import { emailFixture, emailInput } from "./email.fixture.mjs";
import { record, field, string } from "../connected-services/fixtures.mjs";
import { checkedFixture } from "../service-hosting/fixtures.mjs";
import { fixtureNodeEffect } from "../node-runtime/fixture.mjs";
import { runServiceStep } from "../../server/assistant/validation/cases.js";
import {
  newServiceTestReport,
  appendServiceCaseResult,
} from "../../packages/pvo-assistant/services/index.js";

/** A useful acceptance example, not a provider-specific product template. It records the reply and emails the creator. */
export function acceptanceFixture() {
  const { agreement } = emailFixture();
  const state = (names) => ({ guests: names });
  agreement.state = {
    schema: record(
      field("guests", { type: "array", maxItems: 100, items: string(80) }),
    ),
    initial: state([]),
  };
  agreement.operations[0] = {
    ...agreement.operations[0],
    name: "accept",
    description: "Record an acceptance and notify the creator.",
    input: record(field("name", string(80))),
    result: { type: "enum", values: ["accepted", "already_accepted", "full"] },
  };
  agreement.connections[0].operations = ["accept"];
  const step = (name, before, result, after, sends) => ({
    operation: "accept",
    input: { name },
    now: 1,
    requests: sends ? [{ connection: "issue", input: emailInput }] : [],
    expected: { result, state: state(after) },
  });
  agreement.cases = [
    {
      id: "accept-once",
      description:
        "Record one reply and send one notification, even if the guest accepts again.",
      initialState: state([]),
      steps: [
        step("Guest", [], "accepted", ["Guest"], true),
        step("Guest", ["Guest"], "already_accepted", ["Guest"], false),
      ],
    },
    {
      id: "full",
      description: "Do not send after capacity is reached.",
      initialState: state(Array.from({ length: 100 }, (_, i) => `Guest ${i}`)),
      steps: [
        step(
          "Extra",
          [],
          "full",
          Array.from({ length: 100 }, (_, i) => `Guest ${i}`),
          false,
        ),
      ],
    },
  ];
  const source = `export function execute({input,state,connectionResults=[]}) {
    if (state.guests.includes(input.name)) return {result:'already_accepted',state};
    if (state.guests.length >= 100) return {result:'full',state};
    if (!connectionResults.length) return {request:{connection:'issue',input:${JSON.stringify(emailInput)}}};
    if (!connectionResults[0].result.id) throw new Error('Missing provider receipt');
    return {result:'accepted',state:{guests:[...state.guests,input.name]}};
  }`;
  return { agreement, source };
}

/** Real Node execution and existing independent validator; expected cases stay outside each Node process. */
export async function checkedAcceptance({
  connectionId = "connection-one",
} = {}) {
  const { source, agreement } = acceptanceFixture();
  agreement.connections[0].connectionId = connectionId;
  const checked = await checkedFixture(source, agreement);
  const { artifact } = checked;
  const namespace = {
    getByName: () => ({
      execute: async (value) =>
        (
          await fixtureNodeEffect(
            new Request("https://fixture.test", {
              method: "POST",
              body: JSON.stringify(value),
            }),
          )
        ).json(),
      cancel: async () => ({ ok: true }),
    }),
  };
  let report = newServiceTestReport(artifact.agreement, artifact.identity);
  for (let index = 0; index < artifact.agreement.cases.length; index++) {
    let cursor = {
      step: 0,
      state: artifact.agreement.cases[index].initialState,
    };
    for (;;) {
      const result = await runServiceStep(
        namespace,
        artifact.package,
        artifact.agreement,
        artifact.identity.agreementDigest,
        index,
        cursor,
        {
          ownerId: "acceptance-owner",
          serviceId: "acceptance-service",
          mode: "validation",
        },
      );
      if (result.caseResult) {
        if (result.caseResult.status !== "passed")
          throw new Error(JSON.stringify(result.caseResult));
        report = appendServiceCaseResult(
          report,
          artifact.agreement,
          artifact.identity,
          result.caseResult,
        );
        break;
      }
      cursor = { step: cursor.step + 1, state: result.state };
    }
  }
  return { artifact, report };
}
