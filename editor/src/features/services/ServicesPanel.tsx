import { useState } from "react";
import { openSignIn } from "../../state/auth/authGateStore";
import { useServices } from "./useServices";
import styles from "./ServicesPanel.module.css";

/** Account services remain manageable after their authoring component or project is removed. */
export function ServicesPanel() {
  const { services, pending, busy, error, ownerId, refresh, control, retry } =
    useServices();
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  if (!ownerId)
    return (
      <div className={styles.panel}>
        <p>Sign in to manage your services.</p>
        <button type="button" onClick={() => openSignIn()}>
          Sign in
        </button>
      </div>
    );
  return (
    <div className={styles.panel}>
      <p>
        Services belong to your account. Active services keep working after you
        close Restyle or remove their component. Pausing keeps their records;
        deleting removes their program and records.
      </p>
      <button type="button" disabled={busy} onClick={() => void refresh()}>
        Refresh services
      </button>
      {busy && <p role="status">Updating services…</p>}
      {error && <p role="alert">{error}</p>}
      {pending && (
        <div role="status">
          <p>
            A saved {pending.control.kind} action still needs its result
            confirmed.
          </p>
          <button type="button" disabled={busy} onClick={() => void retry()}>
            Retry saved action
          </button>
        </div>
      )}
      {!services.length && !busy && !error && (
        <p>
          No services yet. Services built by the assistant will appear here.
        </p>
      )}
      <ul className={styles.list}>
        {services.map((item) => {
          const service = item.summary?.service,
            id = item.metadata.identity.serviceId;
          const disabled = busy || !!pending || !service;
          return (
            <li key={id}>
              <h4>{item.metadata.description}</h4>
              <p>Status: {service?.state ?? "temporarily unavailable"}</p>
              <details>
                <summary>Service details</summary>
                <p className={styles.identifier}>{id}</p>
                <p>
                  {item.summary?.releases.filter(
                    (release) => release.state !== "deleted",
                  ).length ?? 0}{" "}
                  saved versions
                </p>
                <p>
                  Test records and live records are separate. Undo in the editor
                  does not undo viewer submissions.
                </p>
                {service?.liveReleaseId && (
                  <ul>
                    {item.summary?.releases.map((release, index) =>
                      release.state === "deleted" ? null : (
                        <li key={release.identity.resourceId}>
                          <span>
                            Version {index + 1}
                            {release.identity.resourceId ===
                            service.liveReleaseId
                              ? " · current"
                              : ""}
                          </span>
                          {release.identity.resourceId !==
                            service.liveReleaseId && (
                            <button
                              type="button"
                              disabled={disabled}
                              onClick={() =>
                                control(
                                  item,
                                  "activate",
                                  release.identity.resourceId,
                                )
                              }
                            >
                              Use version {index + 1}
                            </button>
                          )}
                        </li>
                      ),
                    )}
                  </ul>
                )}
                {service?.liveReleaseId && (
                  <p>
                    Changing versions keeps live records and saved replies. A
                    version that cannot use them will be rejected.
                  </p>
                )}
              </details>
              <div className={styles.actions}>
                {service?.state !== "active" && (
                  <button
                    type="button"
                    disabled={
                      disabled ||
                      (!service?.testReleaseId && !service?.liveReleaseId)
                    }
                    onClick={() => control(item, "activate")}
                  >
                    {service?.state === "paused"
                      ? "Resume service"
                      : "Activate service"}
                  </button>
                )}
                {service?.state === "active" && (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => control(item, "pause")}
                  >
                    Pause service
                  </button>
                )}
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => setConfirmDelete(id)}
                >
                  Delete service
                </button>
              </div>
              {confirmDelete === id && (
                <div>
                  <p>
                    Delete this service and all its saved records? Existing
                    copies of the component will stop working.
                  </p>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      setConfirmDelete(null);
                      control(item, "delete");
                    }}
                  >
                    Delete service permanently
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirmDelete(null)}
                  >
                    Keep service
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <details>
        <summary>Current service limits</summary>
        <p>
          Up to 8 services and 4 versions per service. Each test or live data
          area allows 256 new actions and 1,024 calls per day, with up to 512
          saved action results and 2 MiB of results. New actions stop at a
          limit; saved records are kept.
        </p>
      </details>
    </div>
  );
}
