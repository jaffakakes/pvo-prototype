import { productArtifact } from "../node-product/artifact.js";
import { contentDigest } from "../../../server/contentDigest.js";
import { runServiceStep } from "../../../server/assistant/validation/cases.js";
import {
  serializeServiceAgreement,
  serializeServiceFiles,
  serializeServicePackage,
  newServiceTestReport,
  appendServiceCaseResult,
} from "../../../packages/pvo-assistant/services/index.js";

/** Fixed read-only acceptance. No model, credentials, raw provider replies or expected cases enter Node. */
export async function connectedArtifact() {
  const artifact = await productArtifact();
  const string = { type: "string", maxBytes: 256 };
  const adapter = {
    name: "repositoryMetadata",
    description: "Read the connected repository name before accepting a guest.",
    provider: "github",
    method: "GET",
    path: [],
    query: [],
    input: { type: "object", fields: [] },
    result: {
      type: "object",
      fields: [
        { name: "full_name", description: "Repository name", schema: string },
      ],
    },
    responsePath: [],
    permission: "repository:read",
    completion: "synchronous",
    documentation:
      "https://docs.github.com/en/rest/repos/repos#get-a-repository",
  };
  artifact.agreement.connections = [
    {
      name: "repository",
      connectionId: "connected-proof",
      operations: ["join"],
      adapter,
      examples: [
        { input: {}, result: { full_name: "jaffakakes/pvo-prototype" } },
      ],
    },
  ];
  for (const scenario of artifact.agreement.cases)
    for (const step of scenario.steps)
      step.requests = [{ connection: "repository", input: {} }];
  artifact.package.files[0].content =
    artifact.package.files[0].content.replace(
      "export function execute",
      "function localExecute",
    ) +
    `
export function execute(invocation) {
  if (!invocation.connectionResults?.length) return { request: { connection: 'repository', input: {} } };
  if (invocation.connectionResults[0].result.full_name !== 'jaffakakes/pvo-prototype') throw new Error('Wrong connected repository');
  return localExecute(invocation);
}`;
  const agreementDigest = await contentDigest(
    serializeServiceAgreement(artifact.agreement),
  );
  artifact.package.agreementDigest = agreementDigest;
  artifact.identity = {
    agreementDigest,
    sourceDigest: await contentDigest(
      serializeServiceFiles(artifact.package.files),
    ),
    packageDigest: await contentDigest(
      serializeServicePackage(artifact.package),
    ),
  };
  return artifact;
}
export async function checkConnectedArtifact(namespace, scope) {
  const artifact = await connectedArtifact();
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
  }
  return { artifact, report };
}
