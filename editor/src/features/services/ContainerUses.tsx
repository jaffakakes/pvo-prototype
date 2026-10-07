import { useEffect, useState } from "react";
import {
  SERVICE_CONNECTION_LIMITS,
  type ServiceConnections,
} from "../../../../packages/pvo-assistant/hosting/index.js";
import { readContainerConnections } from "../../infrastructure/services/connections";
import { useAuthGate } from "../../state/auth/authGateStore";
import { useAssistantScope } from "../../state/assistant/sessionScope";
import {
  useConnectionSync,
  retryConnectionSync,
} from "../../state/services/connectionSync";
import styles from "./ServicesPanel.module.css";

export function ContainerUses({
  ownerId,
  serviceId,
}: {
  ownerId: string;
  serviceId: string;
}) {
  const [reload, setReload] = useState(0);
  const sync = useConnectionSync();
  const scope = useAssistantScope();
  const key = `${ownerId}:${serviceId}:${reload}:${sync.phase}`;
  const [view, setView] = useState<{
    key: string;
    value: ServiceConnections | null;
    error: string | null;
  } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setView({ key, value: null, error: null });
    const current = () =>
      !controller.signal.aborted && useAuthGate.getState().user?.id === ownerId;
    void readContainerConnections(ownerId, serviceId, controller.signal)
      .then((value) => {
        if (current()) setView({ key, value, error: null });
      })
      .catch((failure) => {
        if (current())
          setView({
            key,
            value: null,
            error:
              failure instanceof Error
                ? failure.message
                : "Couldn’t read Container connections.",
          });
      });
    return () => controller.abort();
  }, [key, ownerId, serviceId]);
  const current = view?.key === key ? view : null;
  const currentSync =
    sync.scope === `${scope.ownerId}:${scope.localId}:${scope.epoch}`;
  const records = current?.value?.records ?? [];
  return (
    <section
      className={styles.editor}
      aria-label="Container connections and exports"
    >
      <h4>Where this Container is used</h4>
      <p>
        Project connections show the last report saved from the editor. Exports
        remain listed after you remove a component. Downloaded or forwarded
        copies can keep working; their viewers cannot all be counted.
      </p>
      <p>
        This Container uses Restyle’s storage and needs no external account.
      </p>
      {currentSync && sync.phase === "pending" && (
        <p role="status">Saving this project’s connection list…</p>
      )}
      {currentSync && sync.phase === "failed" && (
        <div role="status">
          <p>{sync.error} The previously recorded list is kept.</p>
          <button type="button" onClick={retryConnectionSync}>
            Retry connection report
          </button>
        </div>
      )}
      <button type="button" onClick={() => setReload((value) => value + 1)}>
        Refresh connections and exports
      </button>
      {!current?.value && !current?.error && (
        <p role="status">Loading recorded uses…</p>
      )}
      {current?.error && <p role="alert">{current.error}</p>}
      {current?.value && !records.length && (
        <p>No connections or exports have been reported yet.</p>
      )}
      <p>
        {records.filter((record) => record.report.kind === "export").length} of{" "}
        {SERVICE_CONNECTION_LIMITS.exports} exports recorded. These records
        remain until you delete the Container.
      </p>
      {records.map((record) => (
        <details key={`${record.report.kind}:${record.report.referenceId}`}>
          <summary>
            {record.report.kind === "project" ? "Project" : "Export"}:{" "}
            {record.report.title}
          </summary>
          <p>
            {record.report.kind === "export"
              ? "Prepared for download or link sharing"
              : "Last reported project connections"}{" "}
            · {new Date(record.recordedAt).toLocaleString()}
          </p>
          {!record.report.components.length && (
            <p>No components were connected in the last project report.</p>
          )}
          <ul>
            {record.report.components.map((component) => (
              <li key={`${component.sceneId}:${component.componentId}`}>
                {component.sceneName} · {component.componentName} ·{" "}
                {component.operation}
              </li>
            ))}
          </ul>
          {record.publications.length > 0 && (
            <ul aria-label="Recorded published links">
              {record.publications.map((publication) => (
                <li key={publication.id}>
                  <a
                    href={`/player/${encodeURIComponent(publication.id)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {publication.title}
                  </a>
                </li>
              ))}
            </ul>
          )}
          <p className={styles.identifier}>
            Project: {record.report.projectId}
          </p>
        </details>
      ))}
      <p>
        Version changes are checked against retained recorded agreements and
        today’s live records. A new version cannot silently change those fields
        or erase data. Link availability can change after it was recorded.
      </p>
    </section>
  );
}
