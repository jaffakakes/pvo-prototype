import { useId } from "react";
import type { AssistantExchange } from "../../../domain/assistant/thread";
import { fmt } from "../../../ui/formatTime";
import styles from "./AssistantThreadExchange.module.css";

export interface AssistantExchangeActions {
  busy?: boolean;
  actionError?: { id: string; message: string } | null;
  onUndo(id: string): void;
  onRedo(id: string): void;
  onShow(id: string): void;
  canUndo?(item: AssistantExchange): boolean;
  canRedo?(item: AssistantExchange): boolean;
  canShow?(item: AssistantExchange): boolean;
  actionHint?(item: AssistantExchange): string | undefined;
}

type ExchangeRowProps = AssistantExchangeActions & {
  item: AssistantExchange;
  variant: "desktop" | "phone";
};

export function AssistantThreadExchange({
  item, onUndo, onRedo, onShow, canUndo, canRedo, canShow, actionError, actionHint, busy, variant,
}: ExchangeRowProps) {
  const requestId = useId();
  const applied = item.status === "applied";
  const pending = item.status === "pending";
  const noChange = item.status === "failed" || item.status === "cancelled";
  const response = noChange ? "No change made." : item.orb;
  const changeAllowed = item.undone ? canRedo?.(item) : canUndo?.(item);
  const error = actionError?.id === item.id ? actionError.message : item.error;
  const actionMessage = error ?? (applied && !busy && changeAllowed === false ? actionHint?.(item) : undefined);

  return <li className={styles.exchange} data-exchange-id={item.id} data-exchange-status={item.status}
    data-undone={item.undone || undefined} data-variant={variant}>
    <div className={styles.requestRow}>
      <span className={styles.youAvatar} aria-hidden="true">
        {item.kind === "suggestion" ? <span className={styles.sparkle}>✦</span> : "Y"}
      </span>
      <div className={styles.requestBody}>
        <div className={styles.requestMeta}>
          <span>{item.kind === "suggestion" ? "Suggestion" : "You"}</span>
          <span className={styles.timestamp}>{item.kind === "suggestion" ? "accepted at" : "at"} {fmt(item.at)}</span>
        </div>
        {item.kind === "suggestion"
          ? <span className={styles.suggestionChip} id={requestId}>
            <span style={{ background: item.color ?? "#ff6fa6" }} aria-hidden="true" />
            {item.label ?? item.you}
          </span>
          : <p className={styles.request} id={requestId}>{item.you}</p>}
      </div>
    </div>
    <div className={styles.responseRow}>
      <span className={styles.restyleAvatar} aria-hidden="true">
        <img src="restyle-mark.png" alt="" draggable={false} />
      </span>
      <div className={styles.bubble}>
        {pending ? <div className={styles.pending} role="status">
          <span className={styles.spinner} aria-hidden="true" />Working on it…
        </div> : <>
          <p className={styles.response}>{response}</p>
          <div className={styles.results}>
            {item.undone
              ? <span className={`${styles.resultChip} ${styles.undoneChip}`}>Undone</span>
              : <>
                {item.status === "proposed" && <span className={`${styles.resultChip} ${styles.warningChip}`}>Awaiting review</span>}
                {item.status === "cancelled" && <span className={`${styles.resultChip} ${styles.undoneChip}`}>Not kept</span>}
                {!noChange && item.changes.map((change, index) => <span
                  className={`${styles.resultChip} ${change.tone === "warn" ? styles.warningChip : styles.okChip}`}
                  key={`${change.label}-${index}`}>
                  {change.label}
                </span>)}
              </>}
            {applied && <div className={styles.actions}>
              <button type="button" aria-describedby={requestId} disabled={busy || changeAllowed === false}
                title={changeAllowed === false ? actionHint?.(item) : undefined}
                onClick={() => item.undone ? onRedo(item.id) : onUndo(item.id)}>
                {item.undone ? "Redo" : "Undo"}
              </button>
              <button type="button" className={styles.show} aria-describedby={requestId}
                disabled={busy || !item.targets.length || canShow?.(item) === false} onClick={() => onShow(item.id)}>
                Show
              </button>
            </div>}
          </div>
          {actionMessage && <p className={styles.actionError} role="status">{actionMessage}</p>}
        </>}
      </div>
    </div>
  </li>;
}
