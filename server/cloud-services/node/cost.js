/** Dated Fly iad shared-1x / 1 GiB estimate. Wall time is measured; provider billing is not. */
export const NODE_COMPUTE_RATES = Object.freeze({
  checkedOn: "2026-10-07",
  source: "https://fly.io/pricing-update/",
  region: "iad",
  cpuKind: "shared",
  cpus: 1,
  memoryMiB: 1024,
  // Published 256 MiB preset: $0.0030474/hour; 0.75 GiB extra RAM: $6.003072/GiB/720 hours.
  machineSecondUsd: (0.0030474 + 0.75 * (6.003072 / 720)) / 3600,
});

export function estimateNodeCompute(snapshot) {
  const rates = NODE_COMPUTE_RATES;
  const estimate = (milliseconds) => {
    const seconds = milliseconds / 1000;
    return {
      milliseconds,
      computeUsd: seconds * rates.machineSecondUsd,
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
      "Fly shared-1x / 1 GiB in iad, using wall time from admission to confirmed destruction. Includes image preparation, startup, upload and cleanup; this can exceed billed running time. An estimate, not an invoice or spending cap.",
    excluded: [
      "AI model",
      "development workshop",
      "runtime image build and registry",
      "Worker",
      "Durable Object requests and duration",
      "retained storage",
      "stopped Machine root filesystem",
      "network",
      "logs",
      "subscription",
      "tax",
    ],
    allowancesApplied: false,
  };
}
