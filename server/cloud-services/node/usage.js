import {
  parseServiceCompute,
  SERVICE_COMPUTE_MODES,
  SERVICE_COMPUTE_COUNTERS,
} from "../../../packages/pvo-assistant/hosting/index.js";
import { withAssistantDeadline } from "../../assistant/deadline.js";
import { NODE_LIMITS } from "./runtime.js";
import { NODE_COMPUTE_RATES } from "./cost.js";

/** Aggregate private slot accounting only after the service host authorizes its owner. */
export async function readNodeUsage(namespace, ownerId, serviceId) {
  try {
    if (typeof namespace?.getByName !== "function")
      throw new Error("Missing compute binding");
    const snapshots = await Promise.all(
      Array.from({ length: NODE_LIMITS.slots }, (_, index) =>
        withAssistantDeadline(async () => {
          const raw = await namespace
            .getByName(`slot-${index}`)
            .usage(ownerId, serviceId);
          try {
            const { [Symbol.dispose]: dispose, ...value } = raw;
            if (value.ownerId !== ownerId || value.serviceId !== serviceId)
              throw new Error("Compute ownership mismatch");
            return structuredClone(value);
          } finally {
            raw?.[Symbol.dispose]?.();
          }
        }, 2000),
      ),
    );
    if (snapshots.some((s) => s.resetsAt !== snapshots[0].resetsAt))
      throw new Error("Compute day changed during observation");
    if (
      snapshots.some(
        (s) =>
          typeof s.capacity?.busy !== "boolean" || !Object.hasOwn(s, "pending"),
      )
    )
      throw new Error("Incomplete compute observation");
    const periods = Object.fromEntries(
      SERVICE_COMPUTE_MODES.map((mode) => [
        mode,
        Object.fromEntries(
          SERVICE_COMPUTE_COUNTERS.map((key) => [
            key,
            snapshots.reduce((n, s) => n + s.periods[mode][key], 0),
          ]),
        ),
      ]),
    );
    const pending = snapshots.flatMap((s) => (s.pending ? [s.pending] : []));
    const rate = NODE_COMPUTE_RATES;
    const result = {
      state: "available",
      observedAt: Math.min(...snapshots.map((s) => s.observedAt)),
      periodStartAt: Math.min(...snapshots.map((s) => s.periodStartAt)),
      resetsAt: snapshots[0].resetsAt,
      capacity: {
        slots: NODE_LIMITS.slots,
        busySlots: snapshots.filter((s) => s.capacity.busy).length,
        ...Object.fromEntries(
          [
            "ownerRemaining",
            "ownerLimit",
            "platformRemaining",
            "platformLimit",
          ].map((key) => [
            key,
            snapshots.reduce((n, s) => n + s.capacity[key], 0),
          ]),
        ),
      },
      periods,
      pending,
      instance: snapshots[0].instance,
      estimate: {
        checkedOn: rate.checkedOn,
        machineSecondUsd: rate.machineSecondUsd,
        completedUsd:
          (Object.values(periods).reduce((n, p) => n + p.milliseconds, 0) /
            1000) *
          rate.machineSecondUsd,
        pendingUsd:
          (pending.reduce((n, p) => n + p.milliseconds, 0) / 1000) *
          rate.machineSecondUsd,
      },
    };
    // Validate each slot too: aggregation must not hide an invalid/negative counter.
    for (const s of snapshots)
      parseServiceCompute({
        ...result,
        observedAt: s.observedAt,
        periodStartAt: s.periodStartAt,
        resetsAt: s.resetsAt,
        periods: s.periods,
        pending: s.pending ? [s.pending] : [],
        instance: s.instance,
        capacity: {
          slots: 1,
          busySlots: s.capacity.busy ? 1 : 0,
          ownerRemaining: s.capacity.ownerRemaining,
          ownerLimit: s.capacity.ownerLimit,
          platformRemaining: s.capacity.platformRemaining,
          platformLimit: s.capacity.platformLimit,
        },
      });
    return parseServiceCompute(result);
  } catch {
    return { state: "unavailable" };
  }
}
