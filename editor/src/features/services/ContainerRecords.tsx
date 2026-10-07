import { useEffect, useState } from "react";
import {
  HOSTED_SERVICE_LIMITS as limits,
  type ServiceRecords,
  type ServiceRecordsArea,
} from "../../../../packages/pvo-assistant/hosting/index.js";
import { readServiceRecords } from "../../infrastructure/services/client";
import { useAuthGate } from "../../state/auth/authGateStore";
import styles from "./ServicesPanel.module.css";

const failureLabels: Record<string, string> = {
  invalid_input: "The submitted fields did not match the operation.",
  action_conflict: "A retry changed its previously saved input.",
  state_changed:
    "The Container changed during the call. Retry the saved action.",
  budget_exceeded: "A usage or saved-reply limit was reached.",
  invalid_result:
    "The program returned an invalid result. No records were saved.",
  execution_failed: "The program could not finish. Retry the saved action.",
};
const pretty = (value: string) => JSON.stringify(JSON.parse(value), null, 2);

function RecordArea({
  area,
  label,
  disabled,
  onReset,
}: {
  area: ServiceRecordsArea;
  label: string;
  disabled: boolean;
  onReset: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  return (
    <section className={styles.recordArea} aria-label={label}>
      <h5>{label}</h5>
      <p>
        {area.stored
          ? "Saved records"
          : "Starting records · no submissions saved"}{" "}
        · revision {area.version}
      </p>
      <details>
        <summary>View records</summary>
        <pre className={styles.testOutput}>{pretty(area.recordsJson)}</pre>
      </details>
      <p>
        {limits.dailyExecutions - area.usage.executions} of{" "}
        {limits.dailyExecutions} new actions remaining today.{" "}
        {limits.dailyCalls - area.usage.calls} of {limits.dailyCalls} calls
        remaining, including retries. Daily allowances reset at midnight UTC.
      </p>
      <p>
        {area.receipts.count} of {limits.receipts} replies saved ·{" "}
        {Math.ceil(area.receipts.bytes / 1024)} KiB of{" "}
        {limits.receiptBytes / 1024} KiB used. These replies let interrupted
        submissions recover their original result.
      </p>
      <details>
        <summary>Recent results and failures</summary>
        {!area.results.length && <p>No successful actions saved.</p>}
        <ul className={styles.recordEvents}>
          {area.results.map((result) => (
            <li key={result.actionId}>
              <p>
                {result.operation} ·{" "}
                {new Date(result.createdAt).toLocaleString()}
              </p>
              <pre className={styles.testOutput}>
                {pretty(result.resultJson)}
              </pre>
            </li>
          ))}
        </ul>
        {!area.failures.length && <p>No recent failures recorded.</p>}
        <ul className={styles.recordEvents}>
          {area.failures.map((failure, index) => (
            <li key={`${failure.actionId}:${index}`}>
              <p>
                {failure.operation} · {new Date(failure.at).toLocaleString()}
              </p>
              <p>{failureLabels[failure.code]}</p>
            </li>
          ))}
        </ul>
        <p>
          Shows up to five saved results and eight recent failures for this data
          area. Rejected sign-ins, full request queues and unavailable releases
          are excluded.
        </p>
      </details>
      {area.mode === "test" && (
        <>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setConfirm(true)}
          >
            Reset test records
          </button>
          {confirm && (
            <div>
              <p>
                Restore this version’s starting test records? Live records stay
                saved. Earlier retries will still return their original reply;
                usage allowances do not reset. New tests use a new action.
              </p>
              <div className={styles.actions}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    setConfirm(false);
                    onReset();
                  }}
                >
                  Confirm test reset
                </button>
                <button type="button" onClick={() => setConfirm(false)}>
                  Keep test records
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** Private snapshots are cleared/aborted across owner, service and control revisions. */
export function ContainerRecords({
  ownerId,
  serviceId,
  revision,
  disabled,
  onReset,
}: {
  ownerId: string;
  serviceId: string;
  revision: number;
  disabled: boolean;
  onReset: (releaseId: string) => void;
}) {
  const [reload, setReload] = useState(0);
  const [view, setView] = useState<{
    key: string;
    records: ServiceRecords | null;
    error: boolean;
  } | null>(null);
  const key = `${ownerId}:${serviceId}:${revision}:${reload}`;
  useEffect(() => {
    const controller = new AbortController();
    setView({ key, records: null, error: false });
    const valid = () =>
      !controller.signal.aborted && useAuthGate.getState().user?.id === ownerId;
    void readServiceRecords(serviceId, ownerId, controller.signal)
      .then((records) => {
        if (valid()) setView({ key, records, error: false });
      })
      .catch(() => {
        if (valid()) setView({ key, records: null, error: true });
      });
    return () => controller.abort();
  }, [key, ownerId, serviceId]);
  const current = view?.key === key ? view : null;
  return (
    <div className={styles.editor}>
      <button type="button" onClick={() => setReload((value) => value + 1)}>
        Refresh records and usage
      </button>
      {!current?.records && !current?.error && (
        <p role="status">Loading records…</p>
      )}
      {current?.error && (
        <p role="alert">Couldn’t load these records. Refresh to try again.</p>
      )}
      {current?.records && (
        <>
          <p>
            Snapshot taken{" "}
            {new Date(current.records.observedAt).toLocaleString()}. These
            hosted operation counts exclude AI calls, development workshops and
            independent checks. They are not a provider bill.
          </p>
          {!current.records.areas.length && (
            <p>Test a saved draft to create its first records area.</p>
          )}
          {current.records.areas.map((area, index) => (
            <RecordArea
              key={`${area.mode}:${area.releaseId}:${revision}`}
              area={area}
              label={
                area.mode === "live"
                  ? "Live records"
                  : `Test records ${index + (current.records!.areas[0]?.mode === "live" ? 0 : 1)}`
              }
              disabled={disabled}
              onReset={() => onReset(area.releaseId)}
            />
          ))}
          <p>
            Live records remain until you delete the Container. Resetting tests
            preserves saved replies and limits. Unpublished versions and their
            test records expire under the test retention rule.
          </p>
        </>
      )}
    </div>
  );
}
