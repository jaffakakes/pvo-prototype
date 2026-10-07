import {
  SERVICE_COMPUTE_MODES,
  type ServiceCompute,
  type ServiceComputeMode,
} from "../../../../packages/pvo-assistant/hosting/index.js";
import styles from "./ServicesPanel.module.css";

const labels: Record<ServiceComputeMode, string> = {
  live: "Viewer actions",
  test: "Your test actions",
  validation: "Independent checks",
  probe: "Release readiness",
};
const money = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 4,
  maximumFractionDigits: 6,
});
const dollars = (value: number) =>
  value > 0 && value < 0.000001
    ? `< ${money.format(0.000001)}`
    : money.format(value);
const seconds = (value: number) => `${(value / 1000).toFixed(1)} s`;

export function ContainerCompute({
  compute,
  storageBytes,
}: {
  compute: ServiceCompute;
  storageBytes: number;
}) {
  return (
    <section className={styles.recordArea} aria-label="Compute and cost">
      <h5>Compute and cost</h5>
      {compute.state === "unavailable" ? (
        <p role="status">
          Compute usage is unavailable. Refresh to try again. This does not mean
          usage or cost is zero.
        </p>
      ) : (
        <>
          <p>
            <strong>
              {dollars(compute.estimate.completedUsd)} estimated compute
            </strong>{" "}
            for completed runs retained since{" "}
            {new Date(compute.periodStartAt).toLocaleDateString()}.
          </p>
          <p>
            {compute.capacity.ownerRemaining} of {compute.capacity.ownerLimit}{" "}
            cloud runs remaining today across your Containers. Restyle has{" "}
            {compute.capacity.platformRemaining} of{" "}
            {compute.capacity.platformLimit} remaining across all accounts.
            Resets {new Date(compute.resetsAt).toLocaleString()}.
          </p>
          <p>
            {compute.capacity.slots - compute.capacity.busySlots} of{" "}
            {compute.capacity.slots} execution slots available at this snapshot.
            A run starts only when capacity is available.
          </p>
          {!!compute.pending.length && (
            <p role="status">
              {compute.pending.length} run(s) still running or awaiting
              confirmed cleanup · {dollars(compute.estimate.pendingUsd)}{" "}
              estimated so far, shown separately. This amount can increase until
              cleanup is confirmed.
            </p>
          )}
          <div className={styles.usageTableWrap}>
            <table className={styles.usageTable}>
              <caption>Retained completed duration by activity</caption>
              <thead>
                <tr>
                  <th scope="col">Activity</th>
                  <th scope="col">Starts</th>
                  <th scope="col">Time</th>
                  <th scope="col">Estimate</th>
                </tr>
              </thead>
              <tbody>
                {SERVICE_COMPUTE_MODES.map((mode) => (
                  <tr key={mode}>
                    <th scope="row">{labels[mode]}</th>
                    <td>{compute.periods[mode].starts}</td>
                    <td>{seconds(compute.periods[mode].milliseconds)}</td>
                    <td>
                      {dollars(
                        (compute.periods[mode].milliseconds / 1000) *
                          compute.estimate.machineSecondUsd,
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Starts include unfinished runs; their time enters the table after
            cleanup. Counts and estimates were read{" "}
            {new Date(compute.observedAt).toLocaleString()}.
          </p>
          <details>
            <summary>How this estimate is calculated</summary>
            <p>
              Fly in Virginia (iad), one shared CPU and 1 GiB memory. Rates
              checked {compute.estimate.checkedOn}:{" "}
              {dollars(compute.estimate.machineSecondUsd * 3600)} per running
              hour.{" "}
              <a
                href="https://fly.io/pricing-update/"
                target="_blank"
                rel="noreferrer"
              >
                Fly pricing
              </a>
              .
            </p>
            <p>
              Time includes preparation, startup, upload, execution and cleanup.
              This conservative estimate can exceed billed running time. It is
              not an invoice or a spending cap; provider allowances are not
              deducted.
            </p>
            <p>
              AI, development workshops, image builds and storage,
              stopped-machine storage, Restyle requests and storage, network
              transfer, logs, subscriptions and tax are excluded. Check the
              providers’ bills for total charges.
            </p>
          </details>
        </>
      )}
      <p>
        {(storageBytes / 1024).toFixed(1)} KiB retained in this Container’s
        store, including source, versions, records, replies and database
        overhead. This snapshot excludes shared task and compute stores; it is
        not monthly billed storage.
      </p>
    </section>
  );
}
