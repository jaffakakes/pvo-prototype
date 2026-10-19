import styles from "./BottomNotice.module.css";

type Props = {
  message: string;
  action?: string;
  actionLabel?: string;
  onAction?: () => void;
  disabled?: boolean;
  onDismiss?: () => void;
  dismissLabel?: string;
  notificationId?: string;
  announce?: boolean;
};

/** The compact bottom prompt shared by updates and project recovery. */
export function BottomNotice({
  message,
  action,
  actionLabel,
  onAction,
  disabled,
  onDismiss,
  dismissLabel = "Dismiss notification",
  notificationId,
  announce = true,
}: Props) {
  const content = (
    <>
      <img src="restyle-mark.png" alt="" />
      <span>{message}</span>
      {action && <strong>{action}</strong>}
    </>
  );
  return (
    <div className={styles.position} data-notification-root>
      <div
        className={styles.notice}
        role={announce ? "status" : "group"}
        data-notification-id={notificationId}
        data-severity={notificationId ? "error" : undefined}
      >
        {onAction ? (
          <button
            className={styles.update}
            type="button"
            aria-label={actionLabel}
            disabled={disabled}
            onClick={onAction}
          >
            {content}
          </button>
        ) : (
          <div className={styles.update}>{content}</div>
        )}
        {onDismiss && (
          <button
            className={styles.dismiss}
            type="button"
            aria-label={dismissLabel}
            onClick={onDismiss}
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
}
