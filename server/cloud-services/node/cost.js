/** Dated gross compute estimate. Included allowances, actual CPU and other services are not measured here. */
export const NODE_COMPUTE_RATES = Object.freeze({
  checkedOn: "2026-10-07",
  source: "https://developers.cloudflare.com/containers/platform/pricing/",
  memoryGiBSecondUsd: 0.0000025,
  cpuSecondUsd: 0.00002,
  diskGBSecondUsd: 0.00000007,
});

export function estimateNodeCompute(snapshot) {
  const rates = NODE_COMPUTE_RATES;
  const estimate = (milliseconds) => {
    const seconds = milliseconds / 1000;
    const memoryDiskUsd =
      seconds *
      ((snapshot.instance.memoryMiB / 1024) * rates.memoryGiBSecondUsd +
        snapshot.instance.diskGB * rates.diskGBSecondUsd);
    return {
      milliseconds,
      memoryDiskUsd,
      withFullCpuUsd:
        memoryDiskUsd + seconds * snapshot.instance.vcpu * rates.cpuSecondUsd,
    };
  };
  return {
    currency: "USD",
    rates,
    completed: Object.fromEntries(
      Object.entries(snapshot.periods).map(([mode, usage]) => [
        mode,
        estimate(usage.milliseconds),
      ]),
    ),
    pending:
      snapshot.pending === null
        ? null
        : {
            mode: snapshot.pending.mode,
            ...estimate(snapshot.pending.milliseconds),
          },
    basis:
      "Reserved wall time from admission to confirmed destruction; includes startup and cleanup. It may exceed provider running time. Full-CPU assumption is an estimate, not measured CPU or a spending cap.",
    excluded: [
      "AI model",
      "development workshop",
      "Worker",
      "Durable Object requests and duration",
      "retained storage",
      "network",
      "logs",
      "subscription",
      "tax",
    ],
    allowancesApplied: false,
  };
}
