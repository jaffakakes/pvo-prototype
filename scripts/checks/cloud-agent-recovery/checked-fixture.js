import {
  newBuilderState,
  acceptBuilderDecision,
  recordBuilderReview,
} from "../../../packages/pvo-assistant/builder/index.js";
import {
  serializeServicePackage,
  serializeServiceTestReport,
} from "../../../packages/pvo-assistant/services/index.js";
import { prepareServicePublication } from "../../../server/cloud-services/releaseContract.js";

/** Diagnostic-only trusted setup. Product hosting always consumes the actual builder's saved validation result. */
export async function installCheckedDiagnostic(coordinator, claimed, checked) {
  await prepareServicePublication(
    claimed,
    "diagnostic-check",
    checked,
    coordinator.now() + 86_400_000,
  );
  return coordinator.transaction(() => {
    if (!coordinator.builders.current(claimed, coordinator.now()))
      throw new Error("Diagnostic claim changed.");
    const existing = coordinator.builders.get(claimed.id);
    const { artifact, report } = checked;
    if (existing.round) {
      const saved = coordinator.artifacts.verified(claimed.id, existing.round);
      if (
        !saved ||
        serializeServicePackage(saved.artifact.package) !==
          serializeServicePackage(artifact.package) ||
        serializeServiceTestReport(
          saved.report,
          saved.artifact.agreement,
          saved.artifact.identity,
        ) !==
          serializeServiceTestReport(
            report,
            artifact.agreement,
            artifact.identity,
          )
      )
        throw new Error("Diagnostic cannot replace saved checked contents.");
      return;
    }
    let state = acceptBuilderDecision(
      newBuilderState(),
      { kind: "agreement", agreement: artifact.agreement },
      artifact.identity.agreementDigest,
    );
    const review = {
      kind: "review",
      revision: 1,
      digest: artifact.identity.sourceDigest,
      entrypoint: artifact.package.entrypoint,
      tests: artifact.package.tests,
    };
    state = acceptBuilderDecision(state, review);
    coordinator.artifacts.save(claimed.id, state.round, artifact);
    for (const result of report.cases)
      coordinator.artifacts.append(claimed.id, state.round, result);
    coordinator.builders.write(
      claimed.id,
      recordBuilderReview(state, { review, report, error: null }),
    );
  });
}
