import { useEffect, useState } from "react";
import { notificationDefinition, type NotificationKind } from "../../domain/notifications/catalog";
import { dismissNotification, useNotifications } from "../../state/notifications/notificationStore";
import { NotificationIssues } from "./NotificationIssues";
import { useNotificationContext } from "./useNotificationContext";
import { useNotificationTimeout } from "./useNotificationTimeout";
import styles from "./Notifications.module.css";

function NotificationIcon({ kind }: { kind: NotificationKind }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === "warning" ? <><path d="M12 3 22 21H2Z" /><path d="M12 9v5m0 3v.1" /></>
      : <><circle cx="12" cy="12" r="9" />{kind === "success" ? <path d="m8 12 3 3 5-6" />
        : kind === "info" ? <path d="M12 11v6m0-10v.1" /> : <path d="M12 7v6m0 4v.1" />}</>}
  </svg>;
}

export function NotificationHost() {
  const current = useNotifications(state => state.current);
  const announcement = useNotifications(state => state.announcement);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const definition = current && notificationDefinition(current.id);
  const announced = announcement && notificationDefinition(announcement.id);
  useEffect(() => { setHovered(false); setFocused(false); }, [current?.key, current?.createdAt]);
  useNotificationContext();
  useNotificationTimeout(current, hovered || focused);
  return <div className={styles.host} data-notification-root>
    <div className={styles.srOnly} role="status" aria-live="polite" aria-atomic="true">
      {announced && announced.kind !== "error" ? `${announced.kind}: ${announced.message}` : ""}
    </div>
    <div className={styles.srOnly} role="alert" aria-atomic="true">
      {announced?.kind === "error" ? `Error: ${announced.message}` : ""}
    </div>
    {current && definition && <div key={`${current.key}:${current.createdAt}`} className={styles.notice}
      data-notification-id={current.id} data-severity={definition.kind} role="group" aria-label={`${definition.kind} notification`}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)} onBlurCapture={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}>
      <span className={styles.icon}><NotificationIcon kind={definition.kind} /></span>
      <span className={styles.message}>{definition.message}</span>
      <button className={styles.dismiss} aria-label="Dismiss notification" onClick={() => {
        setHovered(false); setFocused(false); dismissNotification();
      }}>×</button>
    </div>}
    <NotificationIssues />
  </div>;
}
