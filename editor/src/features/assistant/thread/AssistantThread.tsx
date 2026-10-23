import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from "react";
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
  timeline?: ReactNode;
  attachments?: ReactNode;
  orb?: ReactNode;
  targetLabel?: string;
  collapsed: boolean;
  keyboardOpen?: boolean;
  draft: string;
  composeEnabled?: boolean;
  autoFocus?: boolean;
  onDraftChange(value: string): void;
  onSubmit(): void;
  onClose(): void;
  onToggleCollapsed(): void;
}

export function AssistantThread({
  variant,
  items,
  savedTask,
  timeline,
  attachments,
  orb,
  targetLabel,
  collapsed,
  keyboardOpen = false,
  draft,
  composeEnabled = false,
  autoFocus = false,
  busy = false,
  actionError,
  onDraftChange,
  onSubmit,
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
  const listId = useId();
  const input = useRef<HTMLTextAreaElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const followLatest = useRef(true);
  const transcriptScroll = useRef(0);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const phone = variant === "phone";
  const earlierCount = Math.max(0, items.length - 1);
  const visibleItems = !phone && collapsed ? items.slice(-1) : items;

  useLayoutEffect(() => {
    const element = list.current;
    if (!element || keyboardOpen) return;
    element.scrollTop = followLatest.current
      ? element.scrollHeight
      : transcriptScroll.current;
  }, [items, collapsed, keyboardOpen]);

  useEffect(() => {
    if (autoFocus && composeEnabled)
      input.current?.focus({ preventScroll: true });
  }, [autoFocus, composeEnabled]);

  return (
    <section
      className={styles.thread}
      data-variant={variant}
      data-assistant-thread
      data-collapsed={!phone && collapsed}
      data-keyboard={phone && keyboardOpen ? "up" : "down"}
      role="dialog"
      aria-label={phone ? "Restyle thread" : undefined}
      aria-labelledby={phone ? undefined : titleId}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
      onTouchStart={(event) => {
        const target = event.target as HTMLElement;
        // Only dismiss from the strip or the top of the transcript, never while composing.
        if (
          !phone ||
          target.closest("button, form, input") ||
          (list.current?.scrollTop ?? 0) > 0
        )
          return;
        const point = event.touches[0];
        touch.current = { x: point.clientX, y: point.clientY };
      }}
      onTouchEnd={(event) => {
        const start = touch.current;
        touch.current = null;
        if (!start) return;
        const point = event.changedTouches[0];
        if (
          point.clientY - start.y > 70 &&
          Math.abs(point.clientX - start.x) < 45
        )
          onClose();
      }}
      onTouchCancel={() => {
        touch.current = null;
      }}
    >
      {!phone && (
        <header className={styles.header} data-thread-header>
          <div className={styles.heading}>
            <h2 id={titleId}>
              Restyle<span className={styles.srOnly}> thread</span>
            </h2>
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
              <Icon name="down" size={13} />
            </button>
          )}
          <button
            type="button"
            className={styles.close}
            aria-label="Close Restyle thread"
            onClick={onClose}
          >
            <Icon name="close" size={14} />
          </button>
        </header>
      )}
      {phone && timeline}
      <ol
        ref={list}
        className={styles.list}
        id={listId}
        aria-label="Restyle exchanges"
        onScroll={(event) => {
          if (keyboardOpen) return;
          const element = event.currentTarget;
          transcriptScroll.current = element.scrollTop;
          followLatest.current =
            element.scrollHeight - element.scrollTop - element.clientHeight <
            24;
        }}
      >
        {savedTask && <li>{savedTask}</li>}
        {visibleItems.map((item) => (
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
        {!items.length && !savedTask && (
          <li className={styles.empty}>
            <p>Your conversation starts here.</p>
          </li>
        )}
      </ol>
      <form
        className={styles.composer}
        data-thread-compose
        onSubmit={(event) => {
          event.preventDefault();
          if (composeEnabled && !busy && draft.trim()) onSubmit();
        }}
      >
        <div className={styles.composeRow}>
          {attachments}
          <textarea
            ref={input}
            aria-label="Describe a change"
            autoComplete="off"
            maxLength={2000}
            disabled={
              (!composeEnabled || busy) && !(phone && keyboardOpen && busy)
            }
            readOnly={busy}
            value={draft}
            rows={1}
            onChange={(event) => onDraftChange(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                if (composeEnabled && !busy && draft.trim()) onSubmit();
              }
            }}
            placeholder="Ask anything"
          />
          {phone && targetLabel && (
            <span className={styles.targetChip} data-thread-target>
              {targetLabel}
            </span>
          )}
          {phone && orb && <div className={styles.orbSlot}>{orb}</div>}
        </div>
      </form>
    </section>
  );
}
