import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import {
  getProjectStorageStatus,
  retryProjectStorage,
  subscribeProjectStorage,
} from "../../app/projectAutosave";
import {
  notificationDefinition,
  type NotificationId,
} from "../../domain/notifications/catalog";
import {
  dismissNotification,
  useNotifications,
} from "../../state/notifications/notificationStore";
import { BottomNotice } from "../../ui/BottomNotice";
import { ProjectStorageStatus } from "../settings/ProjectStorageStatus";
import styles from "./ProjectStorageNotice.module.css";

export function isStorageNotice(id: NotificationId) {
  return (
    id === "saveFailed" || id === "restoreFailed" || id === "projectMissing"
  );
}

export function ProjectStorageNotice({
  inlineRestore,
}: {
  inlineRestore: boolean;
}) {
  const current = useNotifications((state) => state.current);
  const unresolved = useNotifications((state) => state.unresolved);
  const status = useSyncExternalStore(
    subscribeProjectStorage,
    getProjectStorageStatus,
  );
  const [details, setDetails] = useState(false);
  const visible = (id: NotificationId) =>
    isStorageNotice(id) && !(inlineRestore && id === "restoreFailed");
  const notice = current && visible(current.id) ? current : null;
  const issue = unresolved.find((item) => visible(item.id));
  useEffect(() => setDetails(false), [issue?.key]);
  if (!notice && !issue) return null;
  const busy = status.phase === "retrying" || status.storage.phase === "saving";
  const content =
    details && issue ? (
      <div className={styles.recovery} data-notification-root>
        <button
          className={styles.close}
          aria-label="Close save details"
          onClick={() => setDetails(false)}
        >
          ×
        </button>
        <ProjectStorageStatus onlyIssues />
      </div>
    ) : notice ? (
      <BottomNotice
        notificationId={notice.id}
        announce={false}
        message={
          busy
            ? "Saving your project…"
            : notificationDefinition(notice.id).message
        }
        action={
          notice.id === "projectMissing"
            ? undefined
            : busy
              ? "Wait"
              : status.recoveryBlocked
                ? "Review"
                : "Retry"
        }
        actionLabel={
          status.recoveryBlocked
            ? "Review save issue"
            : notice.id === "restoreFailed"
              ? "Retry restore"
              : "Retry save"
        }
        disabled={busy}
        onAction={
          notice.id === "projectMissing"
            ? undefined
            : () => {
                if (status.recoveryBlocked) setDetails(true);
                else void retryProjectStorage();
              }
        }
        onDismiss={busy ? undefined : dismissNotification}
      />
    ) : (
      <div className={styles.position} data-notification-root>
        <button className={styles.reminder} onClick={() => setDetails(true)}>
          Saving paused
        </button>
      </div>
    );
  return createPortal(content, document.querySelector(".app") ?? document.body);
}
