import {
  boundedJson,
  digest,
  list,
  object,
  requireTask as requireService,
  text,
  unique,
} from "../tasks/validation.js";
import { SERVICE_PACKAGE_LIMITS as limits, SERVICE_RUNTIME } from "./limits.js";
import { canonicalJson } from "./json.js";

export function parseServiceFilePath(value) {
  text(value, 160, "Service file path");
  requireService(
    /^(src|tests)\/(?:[a-z0-9][a-z0-9_-]*\/)*[a-z0-9][a-z0-9_.-]*\.mjs$/.test(
      value,
    ) && !value.includes(".."),
    "Service files need unambiguous relative .mjs paths under src/ or tests/.",
  );
  return value;
}

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
  requireService(
    value.runtime === SERVICE_RUNTIME,
    "Unsupported service runtime.",
  );
  parseServiceFilePath(value.entrypoint);
  requireService(
    value.entrypoint.startsWith("src/"),
    "Service entry point must be a source module.",
  );
  // This initial target has a closed, empty lock. A later package adapter must
  // enforce resolution, integrity and network policy before accepting packages.
  list(value.dependencies, 0, "Locked service dependencies");
  list(value.files, limits.files, "Service files");
  for (const file of value.files) {
    object(file, ["path", "content"], "Service file");
    parseServiceFilePath(file.path);
    text(file.content, limits.fileBytes, "Service file content", true);
  }
  const paths = value.files.map((file) => file.path);
  unique(paths, "Service file paths");
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
