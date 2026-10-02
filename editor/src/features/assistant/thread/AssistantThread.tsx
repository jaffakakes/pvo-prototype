import { useEffect, useId, useRef } from "react";
import type { AssistantExchange } from "../../../domain/assistant/thread";
import { Icon } from "../../../ui/Icon";
import type { OrbGestureHandlers } from "../OrbAssistantView";
import { AssistantThreadExchange, type AssistantExchangeActions } from "./AssistantThreadExchange";
import styles from "./AssistantThread.module.css";

export interface AssistantThreadProps extends AssistantExchangeActions {
  variant: "desktop" | "phone";
  items: readonly AssistantExchange[];
  collapsed: boolean;
  draft: string;
  transcript?: string;
  listening?: boolean;
  targetLabel: string | null;
  micHandlers?: OrbGestureHandlers;
  autoFocus?: boolean;
  onDraftChange(value: string): void;
  onSubmit(): void;
  onClose(): void;
  onToggleCollapsed(): void;
  onComposeFocus?(): void;
  onComposeBlur?(): void;
}

function RestyleAvatar({ heading = false }: { heading?: boolean }) {
  return <span className={`${styles.restyleAvatar} ${heading ? styles.headingAvatar : ""}`} aria-hidden="true">
    <img src="restyle-mark.png" alt="" draggable={false} />
  </span>;
}

export function AssistantThread({
  variant, items, collapsed, draft, transcript = "", listening = false, busy = false,
  targetLabel, actionError, micHandlers, autoFocus = true,
  onDraftChange, onSubmit, onClose, onToggleCollapsed, onUndo, onRedo, onShow,
  canUndo, canRedo, canShow, actionHint, onComposeFocus, onComposeBlur,
}: AssistantThreadProps) {
  const titleId = useId();
  const composeHintId = useId();
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLElement>(null);
  const earlierCount = Math.max(0, items.length - 1);
  const changeCount = items.filter(item => item.status === "applied").length;
  const visibleItems = collapsed ? items.slice(-1) : items;
  const displayedDraft = listening ? transcript : draft;

  useEffect(() => {
    if (!autoFocus) return;
    const target = input.current?.disabled ? panel.current : input.current;
    target?.focus({ preventScroll: true });
  }, [autoFocus]);

  return <section ref={panel} tabIndex={-1} className={styles.thread} data-variant={variant} data-assistant-thread
    data-collapsed={collapsed} role="dialog" aria-labelledby={titleId}
    onKeyDown={event => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }}>
    <header className={styles.header} data-thread-header>
      {variant === "desktop" && <RestyleAvatar heading />}
      <div className={styles.heading}>
        <h2 id={titleId}>Restyle<span className={styles.srOnly}> thread</span></h2>
        <p data-thread-session-note title={`This session · ${changeCount} changes · each one undoable`}>
          This session · {changeCount} changes · each one undoable
        </p>
      </div>
      {earlierCount > 0 && <button type="button" className={styles.collapse}
        aria-expanded={!collapsed} aria-controls={listId} onClick={onToggleCollapsed}>
        {collapsed ? `Show ${earlierCount} earlier` : "Collapse"}
        <Icon name="down" size={13} className={styles.chevron} />
      </button>}
      <button type="button" className={styles.close} aria-label="Close Restyle thread"
        title="Close · Esc" onClick={onClose}>
        <Icon name="close" size={14} />
      </button>
    </header>

    {items.length ? <ol className={styles.list} id={listId} aria-label="Restyle exchanges">
      {[...visibleItems].reverse().map(item => <AssistantThreadExchange key={item.id} item={item} busy={busy} variant={variant}
        onUndo={onUndo} onRedo={onRedo} onShow={onShow} canUndo={canUndo} canRedo={canRedo}
        canShow={canShow} actionError={actionError} actionHint={actionHint} />)}
      {collapsed && earlierCount > 0 && <li className={styles.earlierRow}>
        <button type="button" onClick={onToggleCollapsed} aria-controls={listId} aria-expanded="false">
          {earlierCount} earlier {earlierCount === 1 ? "exchange" : "exchanges"}<span>Show</span>
        </button>
      </li>}
    </ol> : <div className={styles.empty}>
      <span className={styles.emptyMark} aria-hidden="true">✦</span>
      <p>Your changes, in one place.</p>
      <span>{targetLabel
        ? "Ask for a change to your selected component. Requests and kept edits will appear here."
        : "Select a component to ask Restyle for a change. Your requests and kept edits will appear here."}</span>
    </div>}

    <form className={styles.composer} data-thread-compose onSubmit={event => {
      event.preventDefault();
      if (!busy && !listening && targetLabel && draft.trim()) onSubmit();
    }}>
      <p className={styles.composeHint} data-thread-compose-hint id={composeHintId} role={listening ? "status" : undefined}>
        {listening ? "Listening… let go to send" : targetLabel ? `Editing ${targetLabel}` : "Select a component to send a request"}
      </p>
      <div className={styles.composeRow}>
        <input ref={input} aria-label="Describe a change" aria-describedby={composeHintId}
          autoComplete="off" maxLength={2000} readOnly={listening} disabled={busy}
          value={displayedDraft} onChange={event => onDraftChange(event.currentTarget.value)}
          onFocus={onComposeFocus} onBlur={onComposeBlur}
          placeholder={variant === "phone" ? "Ask Restyle… or hold the orb to speak" : "Ask Restyle to change this component…"} />
        {variant === "desktop" && micHandlers && <button {...micHandlers} type="button"
          className={styles.mic} aria-label="Hold to speak, let go to send" title="Hold to speak, let go to send"
          aria-pressed={listening} disabled={busy || !targetLabel}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="9" y="2" width="6" height="12" rx="3" />
            <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" />
          </svg>
        </button>}
        <button type="submit" className={styles.send} aria-label="Send request"
          disabled={busy || listening || !targetLabel || !draft.trim()}>
          <Icon name="arrow" size={17} />
        </button>
      </div>
    </form>
  </section>;
}
