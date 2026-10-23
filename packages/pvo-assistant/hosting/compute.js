import { object, integer, choice, time, list } from "../tasks/validation.js";

export const SERVICE_COMPUTE_MODES = Object.freeze([
  "live",
  "test",
  "validation",
  "probe",
]);
export const SERVICE_COMPUTE_COUNTERS = Object.freeze([
  "starts",
  "milliseconds",
  "startupMilliseconds",
  "executionMilliseconds",
  "cleanupMilliseconds",
  "admittedBytes",
  "resultBytes",
]);

function amount(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    throw new Error("Invalid compute estimate.");
}
/** Private usage projection. Missing metering must never look like zero usage. */
export function parseServiceCompute(value) {
  if (value?.state === "unavailable") {
    object(value, ["state"], "Unavailable compute usage");
    return { state: "unavailable" };
  }
  object(
    value,
    [
      "state",
      "observedAt",
      "periodStartAt",
      "resetsAt",
      "capacity",
      "periods",
      "pending",
      "estimate",
      "instance",
    ],
    "Compute usage",
  );
  choice(value.state, ["available"], "Compute usage state");
  for (const key of ["observedAt", "periodStartAt", "resetsAt"])
    time(value[key], key);
  if (
    value.periodStartAt > value.observedAt ||
    value.resetsAt <= value.observedAt
  )
    throw new Error("Invalid compute observation period.");
  const capacity = value.capacity;
  object(
    capacity,
    [
      "busySlots",
      "slots",
      "ownerRemaining",
      "ownerLimit",
      "platformRemaining",
      "platformLimit",
    ],
    "Compute capacity",
  );
  for (const key of Object.keys(capacity))
    integer(capacity[key], Number.MAX_SAFE_INTEGER, key);
  if (
    capacity.slots < 1 ||
    capacity.busySlots > capacity.slots ||
    capacity.ownerRemaining > capacity.ownerLimit ||
    capacity.platformRemaining > capacity.platformLimit
  )
    throw new Error("Invalid compute capacity.");
  object(value.periods, SERVICE_COMPUTE_MODES, "Compute periods");
  for (const mode of SERVICE_COMPUTE_MODES) {
    object(value.periods[mode], SERVICE_COMPUTE_COUNTERS, "Compute counters");
    for (const key of SERVICE_COMPUTE_COUNTERS)
      integer(value.periods[mode][key], Number.MAX_SAFE_INTEGER, key);
    const p = value.periods[mode];
    if (
      p.milliseconds !==
      p.startupMilliseconds + p.executionMilliseconds + p.cleanupMilliseconds
    )
      throw new Error("Compute durations do not match.");
  }
  list(value.pending, capacity.slots, "Pending compute");
  if (value.pending.length > capacity.busySlots)
    throw new Error("Pending compute requires a reserved slot.");
  for (const pending of value.pending) {
    object(
      pending,
      ["mode", "startedAt", "deadlineAt", "phase", "milliseconds"],
      "Pending compute",
    );
    choice(pending.mode, SERVICE_COMPUTE_MODES, "Pending mode");
    choice(pending.phase, ["running", "cleanup"], "Pending phase");
    time(pending.startedAt, "Compute start");
    time(pending.deadlineAt, "Compute deadline");
    integer(pending.milliseconds, Number.MAX_SAFE_INTEGER, "Pending duration");
    if (pending.startedAt > pending.deadlineAt)
      throw new Error("Invalid compute deadline.");
  }
  object(
    value.instance,
    ["provider", "region", "cpuKind", "cpus", "memoryMiB"],
    "Compute instance",
  );
  choice(value.instance.provider, ["fly"], "Compute provider");
  choice(value.instance.region, ["iad"], "Compute region");
  choice(value.instance.cpuKind, ["shared"], "Compute CPU");
  choice(value.instance.cpus, [1], "Compute CPU count");
  choice(value.instance.memoryMiB, [1024], "Compute memory");
  object(
    value.estimate,
    ["checkedOn", "machineSecondUsd", "completedUsd", "pendingUsd"],
    "Compute estimate",
  );
  if (
    typeof value.estimate.checkedOn !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value.estimate.checkedOn)
  )
    throw new Error("Invalid estimate date.");
  for (const key of ["machineSecondUsd", "completedUsd", "pendingUsd"])
    amount(value.estimate[key]);
  return structuredClone(value);
}
