import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { OrbAssistantView, type AssistantPlacement } from "./OrbAssistantView";
import { useAssistantSession } from "./useAssistantSession";
import { useAssistantPlacement } from "./useAssistantPlacement";
import { useOrbVoice } from "./voice/useOrbVoice";
import { clearSelection } from "../../state/editing/clearSelection";
import styles from "./AssistantHost.module.css";

export function OrbAssistant({ placement: position = "workspace", portalTarget }: {
  placement?: AssistantPlacement; portalTarget?: HTMLElement | null;
} = {}) {
  const session = useAssistantSession({ inspectorVisible: position !== "workspace" });
  const host = useRef<HTMLDivElement>(null);
  const orb = useRef<HTMLButtonElement>(null);
  const placement = useAssistantPlacement(host, position, portalTarget);
  const active = session.available && session.phase !== "idle";
  const voice = useOrbVoice({
    enabled: session.available && !!session.target && session.phase !== "working" && session.phase !== "review",
    onTap: () => {
      session.open();
      host.current?.querySelector("input")?.focus({ preventScroll: true });
    }, onListening: session.listen, onSend: words => { void session.submit(words); },
    onCancel: session.cancelVoice, onFailure: session.reportVoiceFailure,
  });
  const close = () => { voice.cancel(); session.close(); orb.current?.focus({ preventScroll: true }); };
  const dismissOutside = () => {
    close();
    if (position === "workspace") clearSelection();
  };

  useEffect(() => {
    if (!active) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (session.phase !== "review" && session.phase !== "working") close();
      }
      if (event.key !== "Tab") return;
      const selector = 'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),[tabindex="0"]';
      const controls = [
        ...Array.from(host.current?.querySelectorAll<HTMLElement>(selector) ?? []),
        ...Array.from(document.querySelectorAll<HTMLElement>(`[data-notification-root] button:not(:disabled)`)),
      ].filter(element => element.getClientRects().length > 0 && !element.closest("[inert]")
        && element.getAttribute("aria-disabled") !== "true" && getComputedStyle(element).visibility !== "hidden");
      if (!controls.length) return;
      const current = controls.indexOf(document.activeElement as HTMLElement);
      const next = current < 0 ? (event.shiftKey ? controls.length - 1 : 0)
        : (current + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
      event.preventDefault();
      controls[next].focus({ preventScroll: true });
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  });

  const view = <div ref={host} className={position === "toolbar" ? styles.toolbarHost : position === "floating" ? styles.floatingHost : styles.host}
    style={position === "workspace" ? { top: placement.top } : undefined}
    data-assistant-region data-active={active}>
    {session.available && <>
      <OrbAssistantView phase={session.phase} target={session.target}
        draft={session.draft} onDraftChange={session.setDraft}
        transcript={session.transcript} proposal={session.review && {
          request: session.review.request,
          tags: session.review.tags,
          summary: `Changed ${session.review.changes.style} style · ${session.review.changes.structure} structure · ${session.review.changes.logic} logic`,
          skipped: session.review.skipped,
          followUps: session.review.proposal.followUps,
        }} modeLabel={session.modeLabel}
        onSubmit={() => { void session.submit(session.draft); }} onClose={dismissOutside}
        onKeep={() => { session.keep(); orb.current?.focus({ preventScroll: true }); }}
        onUndo={session.undo} onEditRequest={session.editRequest} onBefore={session.showBefore} before={session.before}
        onSuggestion={words => { void session.submit(words); }}
        orbHandlers={session.target ? voice.handlers : { onClick: session.open }}
        orbRef={orb} toolbarHeight={placement.toolbarHeight}
        placement={position} availableHeight={placement.availableHeight} />
    </>}
  </div>;
  return portalTarget ? createPortal(view, portalTarget) : view;
}
