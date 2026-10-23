import {
  SERVICE_RUNTIME,
  resolveNodeLibraries,
  serializeServiceAgreement,
  serializeServiceFiles,
  serializeServicePackage,
  newServiceTestReport,
  appendServiceCaseResult,
} from "../../../packages/pvo-assistant/services/index.js";
import { contentDigest } from "../../../server/contentDigest.js";
import { runServiceStep } from "../../../server/assistant/validation/cases.js";

const string = { type: "string", maxBytes: 128 };
const field = (name, schema) => ({ name, description: name, schema });
const record = (...fields) => ({ type: "object", fields });
const empty = { guests: [] },
  full = { guests: ["Alice"] };

/** Fixed diagnostic source. Expected answers stay in the validator, outside each guest. */
export async function productArtifact(variant = "initial") {
  if (!["initial", "updated", "abandoned", "invalid"].includes(variant))
    throw new Error("Unknown diagnostic variant");
  const agreement = {
    description: "Accept one dinner guest and preserve the saved reply.",
    state: {
      schema: record(
        field("guests", { type: "array", maxItems: 1, items: string }),
      ),
      initial: empty,
    },
    operations: [
      {
        name: "join",
        description: "Accept one guest.",
        audience: "public",
        access: "write",
        input: record(field("name", string)),
        result: {
          type: "enum",
          values: ["accepted", "full", "already_joined"],
        },
      },
    ],
    cases: [
      {
        id: "capacity",
        description: "The first guest takes the only place.",
        initialState: empty,
        steps: [
          {
            operation: "join",
            input: { name: "Alice" },
            now: 1,
            expected: { result: "accepted", state: full },
          },
          {
            operation: "join",
            input: { name: "Bob" },
            now: 2,
            expected: { result: "full", state: full },
          },
        ],
      },
    ],
  };
  const agreementDigest = await contentDigest(
    serializeServiceAgreement(agreement),
  );
  const source = `import { customAlphabet } from 'nanoid';
// Reviewed ${variant} diagnostic version.
export function execute({input,state}) {
  if (customAlphabet('x',6)() !== 'xxxxxx') throw new Error('Wrong library');
  if (state.guests.includes(input.name)) return {result:'already_joined',state};
  if (state.guests.length) return {result:'full',state};
  return {result:'accepted',state:${variant === "invalid" ? "state" : "{guests:[input.name]}"}};
}`;
  const pkg = {
    agreementDigest,
    runtime: SERVICE_RUNTIME,
    entrypoint: "src/main.mjs",
    dependencies: resolveNodeLibraries(["nanoid@5.1.6"]),
    files: [
      { path: "src/main.mjs", content: source },
      {
        path: "tests/main.test.mjs",
        content: "// Trusted acceptance runs outside this file.\n",
      },
    ],
    tests: ["tests/main.test.mjs"],
  };
  return {
    agreement,
    package: pkg,
    identity: {
      agreementDigest,
      sourceDigest: await contentDigest(serializeServiceFiles(pkg.files)),
      packageDigest: await contentDigest(serializeServicePackage(pkg)),
    },
  };
}

export async function checkProductArtifact(namespace, scope, variant) {
  const artifact = await productArtifact(variant);
  let report = newServiceTestReport(artifact.agreement, artifact.identity);
  let cursor = { step: 0, state: artifact.agreement.cases[0].initialState };
  for (;;) {
    const result = await runServiceStep(
      namespace,
      artifact.package,
      artifact.agreement,
      artifact.identity.agreementDigest,
      0,
      cursor,
      scope,
    );
    if (result.caseResult) {
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
  return { artifact, report };
}
