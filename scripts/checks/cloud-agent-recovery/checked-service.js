import {
  serializeServiceAgreement,
  serializeServiceFiles,
  serializeServicePackage,
  newServiceTestReport,
  appendServiceCaseResult,
  SERVICE_RUNTIME,
} from "../../../packages/pvo-assistant/services/index.js";
import { contentDigest } from "../../../server/contentDigest.js";
import { runServiceStep } from "../../../server/assistant/validation/cases.js";

// Fixed recovery diagnostic, not a generated product template. No request supplies source or URLs.
const source = `
export async function execute({input,state}) {
  if (input.spin) { while(true) {} }
  if (input.big) return {result:'x'.repeat(70000),state};
  let blocked=false; try {await fetch('https://example.com');} catch {blocked=true;}
  return {result:{answer:input.value*2,blocked,keys:Object.keys(process.env).filter(name=>/SECRET|TOKEN|KEY/.test(name)),auth:null},state};
}`;
const field = (name, schema) => ({ name, description: name, schema });
const record = (...fields) => ({ type: "object", fields });
const number = { type: "integer", minimum: 0, maximum: 1000 },
  bool = { type: "boolean" },
  nil = { type: "null" };
export async function recoveryCheckedService(namespace, scope) {
  const agreement = {
    description: "Verify isolated inactive service recovery.",
    state: { schema: nil, initial: null },
    operations: [
      {
        name: "double",
        description: "Double a diagnostic number.",
        audience: "public",
        access: "read",
        input: record(
          field("value", number),
          field("spin", bool),
          field("big", bool),
        ),
        result: record(
          field("answer", { ...number, maximum: 2000 }),
          field("blocked", bool),
          field("keys", {
            type: "array",
            maxItems: 8,
            items: { type: "string", maxBytes: 128 },
          }),
          field("auth", nil),
        ),
      },
    ],
    cases: [
      {
        id: "double-seven",
        description: "Execute a bounded isolated call.",
        initialState: null,
        steps: [
          {
            operation: "double",
            input: { value: 7, spin: false, big: false },
            now: 1,
            expected: {
              result: { answer: 14, blocked: true, keys: [], auth: null },
              state: null,
            },
          },
        ],
      },
    ],
  };
  const agreementDigest = await contentDigest(
    serializeServiceAgreement(agreement),
  );
  const pkg = {
    agreementDigest,
    runtime: SERVICE_RUNTIME,
    entrypoint: "src/service.mjs",
    dependencies: [],
    files: [
      { path: "src/service.mjs", content: source },
      {
        path: "tests/service.test.mjs",
        content:
          "// Diagnostic package marker; independent checks run outside this file.",
      },
    ],
    tests: ["tests/service.test.mjs"],
  };
  const identity = {
    agreementDigest,
    sourceDigest: await contentDigest(serializeServiceFiles(pkg.files)),
    packageDigest: await contentDigest(serializeServicePackage(pkg)),
  };
  const result = await runServiceStep(
    namespace,
    pkg,
    agreement,
    agreementDigest,
    0,
    { step: 0, state: agreement.cases[0].initialState },
    scope,
  );
  const report = appendServiceCaseResult(
    newServiceTestReport(agreement, identity),
    agreement,
    identity,
    result.caseResult,
  );
  if (report.status !== "passed")
    throw new Error(
      "The diagnostic package did not pass its actual isolated check.",
    );
  return { artifact: { agreement, package: pkg, identity }, report };
}
