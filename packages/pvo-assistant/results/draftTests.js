import {
  object,
  id,
  integer,
  text,
  requireTask,
  boundedJson,
} from "../tasks/validation.js";
import {
  parseServiceAgreement,
  parseServiceTestReport,
} from "../services/index.js";

/** Read-only diagnostics. Parsing a report never grants publication authority. */
export function parseDraftTestResults(value) {
  object(
    value,
    [
      "ownerId",
      "taskId",
      "serviceId",
      "revision",
      "agreement",
      "generated",
      "report",
    ],
    "Draft test results",
  );
  for (const key of ["ownerId", "taskId", "serviceId"]) id(value[key], key);
  integer(value.revision, Number.MAX_SAFE_INTEGER, "Tested draft revision");
  if (value.agreement !== null) parseServiceAgreement(value.agreement);
  if (value.generated !== null) {
    object(
      value.generated,
      ["exitCode", "stdout", "stderr"],
      "Generated test result",
    );
    integer(value.generated.exitCode, 65535, "Test exit code", -255);
    for (const key of ["stdout", "stderr"])
      text(value.generated[key], 64 * 1024, "Test output", true);
  }
  if (value.report !== null) {
    requireTask(
      value.agreement !== null,
      "Test results require their saved agreement.",
    );
    parseServiceTestReport(
      value.report,
      value.agreement,
      value.report.identity,
    );
  }
  boundedJson(value, 256 * 1024, "Draft test results");
  return structuredClone(value);
}
