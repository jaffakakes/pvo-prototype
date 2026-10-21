import { useState } from "react";
import { notificationDefinition } from "../../domain/notifications/catalog";
import { showNotificationIssue, useNotifications } from "../../state/notifications/notificationStore";
import styles from "./Notifications.module.css";

const issueLabels: Record<string, string> = {
  recordingFailed: "Recording issue", importFailed: "Import issue",
};

/** Storage failures have a dedicated bottom recovery prompt. */
export function NotificationIssues() {
  const allUnresolved = useNotifications(state => state.unresolved);
  const current = useNotifications(state => state.current);
  const [expanded, setExpanded] = useState(false);
  const unresolved = allUnresolved.filter(issue => issue.id !== "restoreFailed" && issue.id !== "saveFailed");
  if (!unresolved.length) return null;
  if (!expanded && unresolved.length === 1 && unresolved[0].key === current?.key) return null;
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
          <p>{definition.recovery}</p>
        </li>;
      })}</ul>
    </section>}
  </div>;
}
