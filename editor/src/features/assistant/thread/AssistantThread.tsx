import { useEffect, useId, useRef, type ReactNode } from "react";
import type { AssistantExchange } from "../../../domain/assistant/thread";
import { Icon } from "../../../ui/Icon";
import {
  AssistantThreadExchange,
  type AssistantExchangeActions,
} from "./AssistantThreadExchange";
import styles from "./AssistantThread.module.css";

export interface AssistantThreadProps extends AssistantExchangeActions {
  variant: "desktop" | "phone";
  items: readonly AssistantExchange[];
  savedTask?: ReactNode;
  collapsed: boolean;
  draft: string;
  targetLabel?: string | null;
  composeEnabled?: boolean;
  autoFocus?: boolean;
  onDraftChange(value: string): void;
  onSubmit(): void;
  onStartVoice?(): void;
  onClose(): void;
  onToggleCollapsed(): void;
}

function RestyleAvatar() {
  return (
    <span
      className={`${styles.restyleAvatar} ${styles.headingAvatar}`}
      aria-hidden="true"
    >
      <img src="restyle-mark.png" alt="" draggable={false} />
    </span>
  );
}

export function AssistantThread({
  variant,
  items,
  savedTask,
  collapsed,
  draft,
  targetLabel,
  composeEnabled = false,
  autoFocus = false,
  busy = false,
  actionError,
  onDraftChange,
  onSubmit,
  onStartVoice,
  onClose,
  onToggleCollapsed,
  onUndo,
  onRedo,
  onShow,
  canUndo,
  canRedo,
  canShow,
  actionHint,
}: AssistantThreadProps) {
  const titleId = useId();
  const composeHintId = useId();
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const earlierCount = Math.max(0, items.length - 1);
  const editCount = items.filter((item) => item.status === "applied").length;
  const visibleItems = collapsed ? items.slice(-1) : items;

  useEffect(() => {
    if (autoFocus)
      (composeEnabled ? input.current : close.current)?.focus({
        preventScroll: true,
      });
  }, [autoFocus, composeEnabled]);

  return (
    <section
      className={styles.thread}
      data-variant={variant}
      data-assistant-thread
      data-collapsed={collapsed}
      role="dialog"
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <header className={styles.header} data-thread-header>
        {variant === "desktop" && <RestyleAvatar />}
        <div className={styles.heading}>
          <h2 id={titleId}>
            Restyle<span className={styles.srOnly}> thread</span>
          </h2>
          <p data-thread-session-note>
            This session · {items.length}{" "}
            {items.length === 1 ? "exchange" : "exchanges"} · {editCount}{" "}
            {editCount === 1 ? "edit" : "edits"}
          </p>
        </div>
        {earlierCount > 0 && (
          <button
            type="button"
            className={styles.collapse}
            aria-expanded={!collapsed}
            aria-controls={listId}
            onClick={onToggleCollapsed}
          >
            {collapsed ? `Show ${earlierCount} earlier` : "Collapse"}
            <Icon name="down" size={13} className={styles.chevron} />
          </button>
        )}
        <button
          ref={close}
          type="button"
          className={styles.close}
          aria-label="Close Restyle thread"
          title="Close · Esc"
          onClick={onClose}
        >
          <Icon name="close" size={14} />
        </button>
      </header>

      {items.length || savedTask ? (
        <ol className={styles.list} id={listId} aria-label="Restyle exchanges">
          {savedTask && <li>{savedTask}</li>}
          {[...visibleItems].reverse().map((item) => (
            <AssistantThreadExchange
              key={item.id}
              item={item}
              busy={busy}
              variant={variant}
              actionError={actionError}
              onUndo={onUndo}
              onRedo={onRedo}
              onShow={onShow}
              canUndo={canUndo}
              canRedo={canRedo}
              canShow={canShow}
              actionHint={actionHint}
            />
          ))}
          {collapsed && earlierCount > 0 && (
            <li className={styles.earlierRow}>
              <button
                type="button"
                onClick={onToggleCollapsed}
                aria-controls={listId}
                aria-expanded="false"
              >
                {earlierCount} earlier{" "}
                {earlierCount === 1 ? "exchange" : "exchanges"}
                <span>Show</span>
              </button>
            </li>
          )}
        </ol>
      ) : (
        <div className={styles.empty}>
          <span className={styles.emptyMark} aria-hidden="true">
            ✦
          </span>
          <p>Your conversation starts here.</p>
          <span>
            Ask Restyle to change your edit or answer a question. Requests
            appear here during this session.
          </span>
        </div>
      )}

      {composeEnabled && (
        <form
          className={styles.composer}
          data-thread-compose
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy && draft.trim()) onSubmit();
          }}
        >
          <p
            className={styles.composeHint}
            data-thread-compose-hint
            id={composeHintId}
          >
            {targetLabel
              ? `Selected: ${targetLabel}`
              : "Ask about the whole edit"}
          </p>
          <div className={styles.composeRow}>
            <input
              ref={input}
              aria-label="Describe a change"
              aria-describedby={composeHintId}
              autoComplete="off"
              maxLength={2000}
              disabled={busy}
              value={draft}
              onChange={(event) => onDraftChange(event.currentTarget.value)}
              placeholder="Ask Restyle anything…"
            />
            {onStartVoice && (
              <button
                type="button"
                className={styles.mic}
                aria-label="Start voice input"
                title="Speak a request"
                disabled={busy}
                onClick={onStartVoice}
              >
                <Icon name="microphone" size={18} />
              </button>
            )}
            <button
              type="submit"
              className={styles.send}
              aria-label="Send request"
              disabled={busy || !draft.trim()}
            >
              <Icon name="arrow" size={17} />
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
