import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { notificationDefinition, type NotificationKind } from "../../domain/notifications/catalog";
import { dismissNotification, useNotifications } from "../../state/notifications/notificationStore";
import { performNotificationAction } from "../../state/assistant/nativeAppliedNotification";
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

export function NotificationHost({ inlineRestore = false }: { inlineRestore?: boolean }) {
  const current = useNotifications(state => state.current);
  const announcement = useNotifications(state => state.announcement);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [previewHost, setPreviewHost] = useState<Element | null>(null);
  const visibleCurrent = inlineRestore && current?.id === "restoreFailed" ? null : current;
  const visibleAnnouncement = inlineRestore && announcement?.id === "restoreFailed" ? null : announcement;
  const definition = visibleCurrent && notificationDefinition(visibleCurrent.id);
  const announced = visibleAnnouncement && notificationDefinition(visibleAnnouncement.id);
  useLayoutEffect(() => {
    const host = visibleCurrent?.id === "assistantApplied"
      ? document.querySelector('[data-assistant-region]:has([data-placement="floating"])')
        ?? document.querySelector(".previewArea")
      : null;
    // A requested answer can keep the workspace inert after an edit completes.
    // Its Undo action must remain reachable through the normal notification host.
    setPreviewHost(host?.closest("[inert]") ? null : host);
  }, [visibleCurrent?.key]);
  useEffect(() => { setHovered(false); setFocused(false); }, [visibleCurrent?.key, visibleCurrent?.createdAt]);
  useNotificationContext();
  useNotificationTimeout(visibleCurrent, hovered || focused);
  const notice = visibleCurrent && definition && <div key={`${visibleCurrent.key}:${visibleCurrent.createdAt}`} className={styles.notice}
    data-notification-id={visibleCurrent.id} data-severity={definition.kind} role="group" aria-label={`${definition.kind} notification`}
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocusCapture={() => setFocused(true)} onBlurCapture={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
    }}>
    <span className={styles.icon}>{visibleCurrent.id === "assistantApplied" ? "✦" : <NotificationIcon kind={definition.kind} />}</span>
    <span className={styles.message}>{visibleCurrent.summary ?? definition.message}</span>
    {visibleCurrent.action && <button className={styles.action} onClick={() => performNotificationAction()}>Undo</button>}
    <button className={styles.dismiss} aria-label="Dismiss notification" onClick={() => {
      setHovered(false); setFocused(false); dismissNotification();
    }}>×</button>
  </div>;
  return <div className={styles.host} data-notification-root>
    <div className={styles.srOnly} role="status" aria-live="polite" aria-atomic="true">
      {announced && announced.kind !== "error" ? `${announced.kind}: ${visibleAnnouncement?.summary ?? announced.message}` : ""}
    </div>
    <div className={styles.srOnly} role="alert" aria-atomic="true">
      {announced?.kind === "error" ? `Error: ${announced.message}` : ""}
    </div>
    {previewHost && visibleCurrent?.id === "assistantApplied"
      ? createPortal(<div className={styles.appliedHost} data-notification-root>{notice}</div>, previewHost)
      : notice}
    <NotificationIssues hideRestore={inlineRestore} />
  </div>;
}
