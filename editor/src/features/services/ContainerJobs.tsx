import { useEffect, useRef, useState } from "react";
import {
  JOB_LIMITS,
  type CreatorJobs,
  type JobSummary,
} from "../../../../packages/pvo-assistant/jobs/index.js";
import {
  readContainerJobs,
  controlContainerJob,
} from "../../infrastructure/services/jobs";
import { useAuthGate } from "../../state/auth/authGateStore";
import styles from "./ServicesPanel.module.css";

/** Job inspection is a private snapshot. Unmount and account/version changes invalidate every request. */
export function ContainerJobs({
  ownerId,
  serviceId,
  revision,
  disabled,
}: {
  ownerId: string;
  serviceId: string;
  revision: number;
  disabled: boolean;
}) {
  const [reload, setReload] = useState(0);
  const [view, setView] = useState<{
    key: string;
    data: CreatorJobs | null;
    error: string | null;
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const lifetime = useRef<AbortController | null>(null);
  const key = `${ownerId}:${serviceId}:${revision}:${reload}`;
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    setView({ key, data: null, error: null });
    setBusy(null);
    const valid = () =>
      !controller.signal.aborted && useAuthGate.getState().user?.id === ownerId;
    void readContainerJobs(serviceId, ownerId, controller.signal)
      .then((data) => {
        if (valid()) setView({ key, data, error: null });
      })
      .catch(() => {
        if (valid())
          setView({
            key,
            data: null,
            error: "Couldn’t load background work. Refresh to try again.",
          });
      });
    return () => controller.abort();
  }, [key, ownerId, serviceId]);
  async function command(job: JobSummary, kind: "cancel" | "resume") {
    const controller = lifetime.current;
    const valid = () =>
      controller &&
      !controller.signal.aborted &&
      useAuthGate.getState().user?.id === ownerId;
    if (!controller || !valid() || busy) return;
    setBusy(job.actionId);
    try {
      await controlContainerJob(
        serviceId,
        ownerId,
        job.actionId,
        kind,
        controller.signal,
      );
      if (valid()) setReload((value) => value + 1);
    } catch (error) {
      if (valid())
        setView((previous) =>
          previous?.key === key
            ? {
                ...previous,
                error:
                  error instanceof Error
                    ? error.message
                    : "This action still needs checking.",
              }
            : previous,
        );
    } finally {
      if (valid()) setBusy(null);
    }
  }
  const current = view?.key === key ? view : null;
  return (
    <section
      className={styles.recordArea}
      aria-label="Background work"
      aria-busy={busy !== null}
    >
      <h5>Background work</h5>
      <p>
        Requests continue after the viewer closes the video. Pause holds queued
        work and delivery checks; it cannot unsend an email.
      </p>
      <details>
        <summary>Limits, retention and costs</summary>
        <p>
          Up to {JOB_LIMITS.records} saved jobs and {JOB_LIMITS.daily} new jobs
          per day. Automatic execution tries at most {JOB_LIMITS.attempts}{" "}
          times; email status checks stop after 12 attempts. Completed receipts
          remain for 30 days. Uncertain outcomes stay saved for inspection and
          hold later work. Requests expire seven days after their intended
          start.
        </p>
        <p>
          Node execution and email can incur normal provider charges. Deleting a
          component preserves its action records. Container deletion waits until
          accepted work is resolved.
        </p>
      </details>
      <button
        type="button"
        disabled={busy !== null}
        onClick={() => setReload((value) => value + 1)}
      >
        Refresh background work
      </button>
      {!current?.data && !current?.error && (
        <p role="status">Loading background work…</p>
      )}
      {current?.error && <p role="alert">{current.error}</p>}
      {current?.data?.jobs.length === 0 && <p>No background requests yet.</p>}
      <ul className={styles.recordEvents}>
        {current?.data?.jobs.map((job) => (
          <li key={job.actionId}>
            <p>
              <strong>
                {job.status === "needs_checking"
                  ? "Result needs checking"
                  : job.label}
              </strong>{" "}
              · {job.operation}
            </p>
            <p>
              Received {new Date(job.createdAt).toLocaleString()} ·{" "}
              {job.attempts} execution attempts · {job.polls} delivery checks
            </p>
            {job.schedule && (
              <p>
                Scheduled {new Date(job.schedule.at).toLocaleString()} (
                {job.schedule.timezone})
              </p>
            )}
            {job.lastError && (
              <p>Recorded reason: {job.lastError.replaceAll("_", " ")}</p>
            )}
            {job.providerReceipts.map((receipt) => (
              <p key={receipt.index}>
                Email provider: {receipt.state.replaceAll("_", " ")} · receipt{" "}
                {receipt.id}
              </p>
            ))}
            {job.canResume && (
              <p>
                Check the original email before continuing. If its outcome
                cannot be safely confirmed, it stays saved for review.
              </p>
            )}
            <div className={styles.actions}>
              {job.canCancel && (
                <button
                  type="button"
                  disabled={disabled || busy !== null}
                  onClick={() => void command(job, "cancel")}
                >
                  Cancel queued request
                </button>
              )}
              {job.canResume && (
                <button
                  type="button"
                  disabled={disabled || busy !== null}
                  onClick={() => void command(job, "resume")}
                >
                  Check saved action
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
