import {
  boundedJson,
  digest,
  list,
  object,
  requireTask as requireService,
  unique,
} from "../tasks/validation.js";
import { SERVICE_PACKAGE_LIMITS as limits } from "./limits.js";
import { parseServiceRuntime } from "./runtime.js";
import { parseNodeDependencies } from "./nodeBundle.js";
import { canonicalJson } from "./json.js";
import { parseServiceFilePath, parseServiceFiles } from "./files.js";

/** No executable scripts, credentials, hosted address or test-pass claims in this envelope. */
export function parseServicePackage(value) {
  object(
    value,
    [
      "agreementDigest",
      "runtime",
      "entrypoint",
      "dependencies",
      "files",
      "tests",
    ],
    "Service source package",
  );
  digest(value.agreementDigest, "Saved agreement digest");
  parseServiceRuntime(value.runtime);
  parseServiceFilePath(value.entrypoint);
  requireService(
    value.entrypoint.startsWith("src/"),
    "Service entry point must be a source module.",
  );
  parseNodeDependencies(value.dependencies);
  parseServiceFiles(value.files);
  const paths = value.files.map((file) => file.path);
  requireService(
    paths.includes(value.entrypoint),
    "Service entry point is missing.",
  );
  list(value.tests, limits.tests, "Generated service tests");
  requireService(
    value.tests.length > 0,
    "A service package needs generated tests.",
  );
  for (const path of value.tests) {
    parseServiceFilePath(path);
    requireService(
      path.startsWith("tests/") &&
        path.endsWith(".test.mjs") &&
        paths.includes(path),
      "A generated test module is missing or has an invalid path.",
    );
  }
  unique(value.tests, "Generated service test paths");
  boundedJson(value, limits.packageBytes, "Service source package");
  return structuredClone(value);
}

export const serializeServicePackage = (value) =>
  canonicalJson(parseServicePackage(value));

/** Expected digest must come from the saved agreement, not from generated files. */
export function matchServicePackage(value, expectedAgreementDigest) {
  digest(expectedAgreementDigest, "Expected saved agreement digest");
  const parsed = parseServicePackage(value);
  requireService(
    parsed.agreementDigest === expectedAgreementDigest,
    "Source package belongs to a different behavior agreement.",
  );
  return parsed;
}
