import {
  parseServiceAgreement,
  serializeServiceAgreement,
  matchServicePackage,
  serializeServicePackage,
  serializeServiceFiles,
  SERVICE_RUNTIME,
} from "../../../packages/pvo-assistant/services/index.js";
import { parseWorkspaceSnapshot } from "../../../packages/pvo-assistant/workspaces/index.js";
import {
  parseBuilderState,
  builderStage,
} from "../../../packages/pvo-assistant/builder/index.js";
import { contentDigest } from "../../contentDigest.js";

/** Freeze exact owned source bytes, never files or pass claims returned by the writable computer. */
export async function prepareServiceArtifact(builder, value) {
  builder = parseBuilderState(builder);
  if (builderStage(builder) !== "review")
    throw new Error("A saved review request is required.");
  const review =
    builder.decision.kind === "review"
      ? builder.decision
      : builder.decision.review;
  const source = parseWorkspaceSnapshot(value),
    agreement = parseServiceAgreement(builder.agreement.body);
  if (
    source.revision !== review.revision ||
    source.digest !== review.digest ||
    (await contentDigest(serializeServiceFiles(source.files))) !== source.digest
  )
    throw new Error("Review source does not match its exact saved bytes.");
  const agreementDigest = await contentDigest(
    serializeServiceAgreement(agreement),
  );
  if (agreementDigest !== builder.agreement.digest)
    throw new Error("Saved agreement digest does not match.");
  const packageValue = matchServicePackage(
    {
      agreementDigest,
      runtime: SERVICE_RUNTIME,
      entrypoint: review.entrypoint,
      dependencies: [],
      files: source.files,
      tests: review.tests,
    },
    agreementDigest,
  );
  const body = serializeServicePackage(packageValue);
  return {
    agreement,
    package: packageValue,
    identity: {
      agreementDigest,
      packageDigest: await contentDigest(body),
      sourceDigest: source.digest,
    },
  };
}
