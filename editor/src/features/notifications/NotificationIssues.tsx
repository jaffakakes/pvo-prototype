import { useState } from "react";
import { notificationDefinition } from "../../domain/notifications/catalog";
import { showNotificationIssue, useNotifications } from "../../state/notifications/notificationStore";
import { ProjectStorageStatus } from "../settings/ProjectStorageStatus";
import styles from "./Notifications.module.css";

const issueLabels: Record<string, string> = {
  saveFailed: "Save issue", restoreFailed: "Restore issue", recordingFailed: "Recording issue", importFailed: "Import issue",
};

/** A dismissed banner is an acknowledgement, never proof of recovery. */
export function NotificationIssues({ hideRestore = false }: { hideRestore?: boolean }) {
  const allUnresolved = useNotifications(state => state.unresolved);
  const current = useNotifications(state => state.current);
  const [expanded, setExpanded] = useState(false);
  const unresolved = hideRestore ? allUnresolved.filter(issue => issue.id !== "restoreFailed") : allUnresolved;
  if (!unresolved.length) return null;
  if (!expanded && unresolved.length === 1 && unresolved[0].key === current?.key) return null;
  const hasStorageIssue = unresolved.some(issue => issue.id === "saveFailed" || issue.id === "restoreFailed");
  const label = unresolved.length === 1 ? issueLabels[unresolved[0].id] ?? "Unresolved issue" : `Issues (${unresolved.length})`;
  return <div className={styles.issues}>
    <button className={styles.issueToggle} aria-expanded={expanded} aria-controls="notification-issues"
      onClick={() => setExpanded(value => !value)}>
      <span aria-hidden="true">!</span>{label}
    </button>
    {expanded && <section id="notification-issues" className={styles.issuePanel} aria-label="Unresolved issues">
      <div className={styles.issueHeading}><strong>Unresolved issues</strong>
        <button className={styles.dismiss} aria-label="Close unresolved issues" onClick={() => setExpanded(false)}>×</button>
      </div>
      <ul>{unresolved.map(issue => {
        const definition = notificationDefinition(issue.id);
        return <li key={issue.key}>
          <button className={styles.issueLink} onClick={() => { showNotificationIssue(issue.key); setExpanded(false); }}>
            {definition.message}
          </button>
          {issue.id !== "saveFailed" && issue.id !== "restoreFailed" && <p>{definition.recovery}</p>}
        </li>;
      })}</ul>
      {hasStorageIssue && <ProjectStorageStatus onlyIssues />}
    </section>}
  </div>;
}
