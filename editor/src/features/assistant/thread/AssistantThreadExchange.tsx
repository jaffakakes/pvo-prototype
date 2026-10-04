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
  canUndo(item: AssistantExchange): boolean;
  canRedo(item: AssistantExchange): boolean;
  canShow(item: AssistantExchange): boolean;
  actionHint?(item: AssistantExchange): string | undefined;
}

type ExchangeRowProps = AssistantExchangeActions & {
  item: AssistantExchange;
  variant: "desktop" | "phone";
};

function resultLabel(item: AssistantExchange): string {
  switch (item.status) {
    case "applied": return item.undone ? "Undone" : "Applied";
    case "answered": return "Answered";
    case "failed": return "No change made";
    case "cancelled": return "Stopped";
    case "pending": return "Working";
  }
}

export function AssistantThreadExchange({
  item, onUndo, onRedo, onShow, canUndo, canRedo, canShow, actionError, actionHint, busy, variant,
}: ExchangeRowProps) {
  const requestId = useId();
  const applied = item.status === "applied";
  const pending = item.status === "pending";
  const canToggle = item.undone ? canRedo(item) : canUndo(item);
  const canNavigate = !!item.target && canShow(item);
  const error = actionError?.id === item.id ? actionError.message : undefined;
  const actionBlocked = applied && !canToggle || !!item.target && !canNavigate;
  const actionMessage = error ?? (!busy && actionBlocked ? actionHint?.(item) : undefined);
  const response = item.response || (item.status === "failed" ? "Restyle could not complete this request."
    : item.status === "cancelled" ? "Request stopped." : item.status === "applied" ? "Changes applied." : "");

  return <li className={styles.exchange} data-exchange-id={item.id}
    data-exchange-status={item.status} data-undone={item.undone || undefined} data-variant={variant}>
    <div className={styles.requestRow}>
      <span className={styles.youAvatar} aria-hidden="true">Y</span>
      <div className={styles.requestBody}>
        <div className={styles.requestMeta}>
          <span>You</span>
          <span className={styles.timestamp}>at {fmt(item.at)}</span>
          {item.target && <span className={styles.targetLabel}>{item.target.label}</span>}
        </div>
        <p className={styles.request} id={requestId}>{item.request}</p>
      </div>
    </div>
    <div className={styles.responseRow}>
      <span className={styles.restyleAvatar} aria-hidden="true">
        <img src="restyle-mark.png" alt="" draggable={false} />
      </span>
      <div className={styles.bubble}>
        {pending ? <div className={styles.pending} role="status">
          <span className={styles.spinner} aria-hidden="true" />{item.progress || "Working on it…"}
        </div> : <>
          {response && <p className={styles.response}>{response}</p>}
          <div className={styles.results}>
            <span className={`${styles.resultChip} ${applied && !item.undone ? styles.okChip
              : item.status === "failed" ? styles.warningChip : styles.undoneChip}`}>
              {resultLabel(item)}
            </span>
            {item.summary && <span className={`${styles.resultChip} ${item.undone ? styles.undoneChip : styles.okChip}`}>
              {item.summary}
            </span>}
            {(applied || item.target) && <div className={styles.actions}>
              {applied && <button type="button" aria-describedby={requestId}
                disabled={busy || !canToggle} title={!canToggle ? actionHint?.(item) : undefined}
                onClick={() => item.undone ? onRedo(item.id) : onUndo(item.id)}>
                {item.undone ? "Redo" : "Undo"}
              </button>}
              {item.target && <button type="button" className={styles.show} aria-describedby={requestId}
                disabled={busy || !canNavigate} title={!canNavigate ? actionHint?.(item) : undefined}
                onClick={() => onShow(item.id)}>
                Show
              </button>}
            </div>}
          </div>
          {actionMessage && <p className={styles.actionError} role="status">{actionMessage}</p>}
        </>}
      </div>
    </div>
  </li>;
}
