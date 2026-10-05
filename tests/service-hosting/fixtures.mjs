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
export async function checkedFixture(source) {
  const agreement = dinnerAgreement(),
    pkg = packageFor(source);
  pkg.agreementDigest = await contentDigest(
    serializeServiceAgreement(agreement),
  );
  const identity = {
    agreementDigest: pkg.agreementDigest,
    sourceDigest: await contentDigest(serializeServiceFiles(pkg.files)),
    packageDigest: await contentDigest(serializeServicePackage(pkg)),
  };
  const report = appendServiceCaseResult(
    newServiceTestReport(agreement, identity),
    agreement,
    identity,
    { id: "capacity", status: "passed", completedSteps: 4, failure: null },
  );
  return { artifact: { agreement, package: pkg, identity }, report };
}
