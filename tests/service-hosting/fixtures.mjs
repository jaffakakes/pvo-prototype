import {
  serializeServiceAgreement,
  serializeServiceFiles,
  serializeServicePackage,
  newServiceTestReport,
  appendServiceCaseResult,
} from "../../packages/pvo-assistant/services/index.js";
import { contentDigest } from "../../server/contentDigest.js";
import {
  packageFor,
  dinnerAgreement,
} from "../service-validation/fixtures.mjs";

/** Synthetic trusted receipt for contract/storage tests, never product or live acceptance evidence. */
export async function checkedFixture(source, agreement = dinnerAgreement()) {
  const pkg = packageFor(source);
  pkg.agreementDigest = await contentDigest(
    serializeServiceAgreement(agreement),
  );
  const identity = {
    agreementDigest: pkg.agreementDigest,
    sourceDigest: await contentDigest(serializeServiceFiles(pkg.files)),
    packageDigest: await contentDigest(serializeServicePackage(pkg)),
  };
  let report = newServiceTestReport(agreement, identity);
  for (const scenario of agreement.cases)
    report = appendServiceCaseResult(report, agreement, identity, {
      id: scenario.id,
      status: "passed",
      completedSteps: scenario.steps.length,
      failure: null,
    });
  return { artifact: { agreement, package: pkg, identity }, report };
}
