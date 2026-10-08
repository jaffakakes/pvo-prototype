import {
  object,
  id,
  integer,
  choice,
  list,
  text,
  time,
  boundedJson,
  unique,
} from "../tasks/validation.js";
import { SERVICE_PACKAGE_LIMITS } from "../services/limits.js";
import { SERVICE_CATALOG_LIMITS } from "../releases/index.js";
import { parseHostedService } from "./service.js";
import { HOSTED_SERVICE_LIMITS } from "./actions.js";
import { parseServiceCompute } from "./compute.js";

export const SERVICE_RECORD_LIMITS = Object.freeze({
  results: 5,
  failures: 8,
  bytes: 1024 * 1024,
});
export const SERVICE_FAILURE_CODES = Object.freeze([
  "invalid_input",
  "action_conflict",
  "state_changed",
  "budget_exceeded",
  "invalid_result",
  "execution_failed",
  "needs_checking",
]);

function jsonText(value, maximum, path) {
  text(value, maximum, path);
  JSON.parse(value);
}
function area(value) {
  object(
    value,
    [
      "mode",
      "releaseId",
      "stored",
      "version",
      "recordsJson",
      "usage",
      "receipts",
      "results",
      "failures",
      "pending",
    ],
    "Service records area",
  );
  choice(value.mode, ["live", "test"], "Service records mode");
  id(value.releaseId, "Records release");
  choice(value.stored, [true, false], "Stored records");
  integer(value.version, Number.MAX_SAFE_INTEGER, "Records version");
  jsonText(
    value.recordsJson,
    SERVICE_PACKAGE_LIMITS.stateBytes,
    "Saved records",
  );
  object(value.usage, ["day", "calls", "executions"], "Service usage");
  integer(value.usage.day, Number.MAX_SAFE_INTEGER, "Usage day");
  integer(value.usage.calls, HOSTED_SERVICE_LIMITS.dailyCalls, "Service calls");
  integer(
    value.usage.executions,
    HOSTED_SERVICE_LIMITS.dailyExecutions,
    "Service executions",
  );
  object(value.receipts, ["count", "bytes"], "Saved replies");
  integer(
    value.receipts.count,
    HOSTED_SERVICE_LIMITS.receipts,
    "Saved reply count",
  );
  integer(
    value.receipts.bytes,
    HOSTED_SERVICE_LIMITS.receiptBytes,
    "Saved reply bytes",
  );
  list(value.results, SERVICE_RECORD_LIMITS.results, "Recent results");
  for (const result of value.results) {
    object(
      result,
      ["actionId", "operation", "releaseId", "createdAt", "resultJson"],
      "Recent result",
    );
    for (const key of ["actionId", "operation", "releaseId"])
      id(result[key], key);
    time(result.createdAt, "Result time");
    jsonText(
      result.resultJson,
      SERVICE_PACKAGE_LIMITS.resultBytes,
      "Saved result",
    );
  }
  list(value.failures, SERVICE_RECORD_LIMITS.failures, "Recent failures");
  for (const failure of value.failures) {
    object(
      failure,
      ["actionId", "operation", "releaseId", "at", "code"],
      "Recent failure",
    );
    for (const key of ["actionId", "operation", "releaseId"])
      id(failure[key], key);
    time(failure.at, "Failure time");
    choice(failure.code, SERVICE_FAILURE_CODES, "Failure code");
  }
  if (value.pending !== null) {
    object(
      value.pending,
      ["actionId", "operation", "releaseId", "status", "startedAt"],
      "Pending outside action",
    );
    for (const key of ["actionId", "operation", "releaseId"])
      id(value.pending[key], key);
    choice(
      value.pending.status,
      ["running", "needs_checking"],
      "Outside action status",
    );
    time(value.pending.startedAt, "Outside action start");
  }
  return structuredClone(value);
}
/** Private diagnostic projection only; it cannot authorize a call or a release. */
export function parseServiceRecords(value) {
  object(
    value,
    ["service", "observedAt", "areas", "storageBytes", "compute"],
    "Service records",
  );
  integer(value.storageBytes, Number.MAX_SAFE_INTEGER, "Service storage bytes");
  const compute = parseServiceCompute(value.compute);
  const service = parseHostedService(value.service);
  time(value.observedAt, "Records observation time");
  list(
    value.areas,
    SERVICE_CATALOG_LIMITS.releases + 1,
    "Service records areas",
  );
  const areas = value.areas.map(area);
  unique(
    areas.map((item) => (item.mode === "live" ? "live" : item.releaseId)),
    "Records areas",
  );
  if (
    areas.some(
      (item) =>
        item.usage.day !== Math.floor(value.observedAt / 86400000) ||
        (item.mode === "live" && item.releaseId !== service.liveReleaseId),
    )
  )
    throw new Error("Service records observation conflicts.");
  boundedJson(value, SERVICE_RECORD_LIMITS.bytes, "Service records");
  return {
    service,
    observedAt: value.observedAt,
    areas,
    storageBytes: value.storageBytes,
    compute,
  };
}
