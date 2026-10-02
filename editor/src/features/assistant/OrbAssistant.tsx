import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { OrbAssistantView, type AssistantPlacement } from "./OrbAssistantView";
import { useAssistantSession } from "./useAssistantSession";
import { useAssistantPlacement } from "./useAssistantPlacement";
import { useOrbVoice } from "./voice/useOrbVoice";
import { AssistantThread } from "./thread/AssistantThread";
import { setAssistantThreadCollapsed, useAssistantThread } from "../../state/assistant/threadStore";
import { assistantExchangeAvailability, showAssistantExchange, toggleAssistantExchange } from "../../state/assistant/threadCommands";
import styles from "./AssistantHost.module.css";

export function OrbAssistant({ placement: position = "workspace", portalTarget, threadKeyboardOpen = false }: {
  placement?: AssistantPlacement; portalTarget?: HTMLElement | null; threadKeyboardOpen?: boolean;
} = {}) {
  const session = useAssistantSession({ inspectorVisible: position !== "workspace" });
  const thread = useAssistantThread();
  const host = useRef<HTMLDivElement>(null);
  const orb = useRef<HTMLButtonElement>(null);
  const placement = useAssistantPlacement(host, position, portalTarget);
  const active = session.available && (thread.open || session.phase !== "idle");
  const [keyboardExpanded, setKeyboardExpanded] = useState(false);
  useEffect(() => { setKeyboardExpanded(false); }, [threadKeyboardOpen]);
  const collapsed = threadKeyboardOpen ? !keyboardExpanded : thread.collapsed;
  const voice = useOrbVoice({
    enabled: session.available && !!session.target && session.phase !== "working" && session.phase !== "review",
    onTap: () => { session.open(); host.current?.querySelector("input")?.focus({ preventScroll: true }); },
    onListening: session.listen, onSend: words => { void session.submit(words); },
    onCancel: session.cancelVoice, onFailure: session.reportVoiceFailure,
  });
  const close = () => { voice.cancel(); session.close(); orb.current?.focus({ preventScroll: true }); };
  const wasOpen = useRef(thread.open);
  useEffect(() => {
    if (!thread.open) {
      voice.cancel();
      if (wasOpen.current && session.phase !== "review") orb.current?.focus({ preventScroll: true });
    }
    wasOpen.current = thread.open;
  }, [thread.open, session.phase, voice.cancel]);
  const show = (id: string) => {
    close();
    if (!showAssistantExchange(id).ok) return;
    requestAnimationFrame(() => {
      const target = thread.items.find(item => item.id === id)?.targets[0];
      if (!target) return;
      const escaped = CSS.escape(target.componentId);
      const lane = document.querySelector(`[data-layer-id="component:${escaped}"]`);
      lane?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
    });
  };

  useEffect(() => {
    if (!active) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (session.phase !== "review") close();
      }
      if (event.key !== "Tab") return;
      const selector = 'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),[tabindex="0"]';
      const controls = [
        ...Array.from(host.current?.querySelectorAll<HTMLElement>(selector) ?? []),
        ...Array.from(document.querySelectorAll<HTMLElement>('[data-thread-resize] [tabindex="0"], [data-notification-root] button:not(:disabled)')),
      ].filter(element => element.getClientRects().length > 0 && !element.closest("[inert]")
        && element.getAttribute("aria-disabled") !== "true" && getComputedStyle(element).visibility !== "hidden");
      if (!controls.length) return;
      const current = controls.indexOf(document.activeElement as HTMLElement);
      const next = current < 0 ? (event.shiftKey ? controls.length - 1 : 0)
        : (current + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
      event.preventDefault();
      controls[next].focus({ preventScroll: true });
    };
    const outside = (event: PointerEvent) => {
      if (!thread.open || !(event.target instanceof Element) || host.current?.contains(event.target)
        || event.target.closest('[data-thread-resize], [data-notification-root]')) return;
      close();
    };
    window.addEventListener("keydown", key, true);
    document.addEventListener("pointerdown", outside, true);
    return () => {
      window.removeEventListener("keydown", key, true);
      document.removeEventListener("pointerdown", outside, true);
    };
  });

  const view = <div ref={host} className={position === "toolbar" ? styles.toolbarHost : position === "floating" ? styles.floatingHost : styles.host}
    style={position === "workspace" ? { top: placement.top } : undefined}
    data-assistant-region data-active={active}>
    {session.available && <>
      {thread.open && <div className={position === "workspace" ? styles.threadDock : styles.threadPopover}
        style={position !== "workspace" ? { maxHeight: Math.max(160, placement.availableHeight - 66) } : undefined}>
        <div className={styles.threadContent}>
          <AssistantThread variant={position === "workspace" ? "phone" : "desktop"}
            items={thread.items} collapsed={collapsed} draft={thread.draft} transcript={session.transcript}
            listening={session.phase === "listening"} busy={session.phase === "working"}
            autoFocus={session.phase !== "listening" && session.phase !== "working"}
            targetLabel={session.target ? session.target.type : null}
            onDraftChange={session.setDraft} onSubmit={() => { void session.submit(thread.draft); }}
            onClose={close} onToggleCollapsed={() => {
              if (threadKeyboardOpen) setKeyboardExpanded(value => !value);
              else setAssistantThreadCollapsed(!thread.collapsed);
            }}
            onUndo={id => { toggleAssistantExchange(id); }} onRedo={id => { toggleAssistantExchange(id); }} onShow={show}
            canUndo={item => session.phase !== "working" && assistantExchangeAvailability(item).canUndo}
            canRedo={item => session.phase !== "working" && assistantExchangeAvailability(item).canRedo}
            canShow={item => session.phase !== "working" && assistantExchangeAvailability(item).canShow}
            actionHint={item => assistantExchangeAvailability(item).message}
            micHandlers={voice.handlers} />
        </div>
      </div>}
      <OrbAssistantView phase={session.phase} target={session.target} threadOpen={thread.open}
        exchangeCount={thread.items.length} changeCount={thread.items.filter(item => item.status === "applied").length}
        proposal={session.review && {
          request: session.review.request,
          tags: session.review.tags,
          summary: `Changed ${session.review.changes.style} style · ${session.review.changes.structure} structure · ${session.review.changes.logic} logic`,
          skipped: session.review.skipped,
          followUps: session.review.proposal.followUps,
        }} modeLabel={session.modeLabel}
        onKeep={() => { session.keep(); orb.current?.focus({ preventScroll: true }); }}
        onUndo={session.undo} onEditRequest={session.editRequest} onBefore={session.showBefore} before={session.before}
        onSuggestion={words => { void session.submit(words); }}
        orbHandlers={session.target && session.phase !== "working" ? voice.handlers : { onClick: session.open }}
        orbRef={orb} toolbarHeight={placement.toolbarHeight}
        placement={position} availableHeight={placement.availableHeight} />
    </>}
  </div>;
  return portalTarget ? createPortal(view, portalTarget) : view;
}
