import { SavedTaskPanel } from "./saved-tasks/SavedTaskPanel";
import { setAssistantMinimized } from "../../state/assistant/assistantStore";
import { useAssistantScope } from "../../state/assistant/sessionScope";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  OrbAssistantView,
  type AssistantPlacement,
  type OrbGestureHandlers,
} from "./OrbAssistantView";
import { useAssistantSession } from "./useAssistantSession";
import { useAssistantPlacement } from "./useAssistantPlacement";
import { useOrbVoice } from "./voice/useOrbVoice";
import { AssistantComparison } from "./AssistantComparison";
import { AssistantAttachments } from "./attachments/AssistantAttachments";
import { AssistantMiniTimeline } from "./thread/AssistantMiniTimeline";
import { AssistantThread } from "./thread/AssistantThread";
import {
  getAssistantThreadReceipt,
  setAssistantThreadCollapsed,
  setAssistantThreadOpen,
  useAssistantThread,
} from "../../state/assistant/threadStore";
import {
  assistantThreadActionAvailability,
  redoAssistantThreadExchange,
  showAssistantThreadExchange,
  undoAssistantThreadExchange,
} from "../../state/assistant/threadCommands";
import { clearSelection } from "../../state/editing/clearSelection";
import { useCapture } from "../../state/captureStore";
import styles from "./AssistantHost.module.css";

export function OrbAssistant({
  mode = "timeline",
  placement: position = "workspace",
  portalTarget,
  threadKeyboardOpen = false,
}: {
  mode?: "timeline" | "design";
  placement?: AssistantPlacement;
  portalTarget?: HTMLElement | null;
  threadKeyboardOpen?: boolean;
} = {}) {
  const session = useAssistantSession({
    inspectorVisible: mode === "design" || position !== "workspace",
  });
  const thread = useAssistantThread();
  const ownerId = useAssistantScope((state) => state.ownerId);
  const links = useCapture((state) => state.assistantTaskLinks);
  const hasSavedTask =
    !!links &&
    (ownerId
      ? links.accounts.some((item) => item.ownerId === ownerId) ||
        links.pending?.some((item) => item.ownerId === ownerId)
      : links.accounts.length > 0 || !!links.pending?.length);
  const host = useRef<HTMLDivElement>(null);
  const orb = useRef<HTMLButtonElement>(null);
  const placement = useAssistantPlacement(host, position, portalTarget);
  const compact = position === "workspace" && !thread.open;
  const minimized =
    compact &&
    session.minimized &&
    (session.phase === "working" || session.phase === "review");
  const active =
    session.available &&
    !minimized &&
    (session.phase !== "idle" || thread.open);
  const [comparing, setComparing] = useState(false);
  useEffect(() => {
    if (!compact || (session.phase !== "working" && session.phase !== "review"))
      setAssistantMinimized(false);
  }, [compact, session.phase]);
  const lastExchange = thread.items.at(-1);
  const receipt = lastExchange
    ? getAssistantThreadReceipt(lastExchange.id)
    : null;
  const before = receipt?.change.past.at(-1);
  const comparisonTarget =
    host.current?.closest(".app")?.querySelector<HTMLElement>(".pvBox") ?? null;
  const reviewActions =
    lastExchange?.status === "applied" &&
    session.answer?.request === lastExchange.request
      ? assistantThreadActionAvailability(lastExchange.id)
      : null;
  useEffect(() => {
    setComparing(false);
  }, [session.phase, thread.open, lastExchange?.id]);
  useEffect(() => {
    if (!comparing) return;
    const end = () => setComparing(false);
    window.addEventListener("blur", end);
    return () => window.removeEventListener("blur", end);
  }, [comparing]);
  const threadPending = thread.items.some((item) => item.status === "pending");
  const working = session.phase === "working" || threadPending;
  const open = session.open;
  const openThread = () => {
    session.open();
    setAssistantThreadOpen(true);
  };
  const voice = useOrbVoice({
    contextKey: session.voiceContext,
    enabled: session.available && !working && session.phase !== "review",
    onDoubleTap:
      position === "workspace" && session.phase === "idle" && !thread.open
        ? openThread
        : undefined,
    onTap: () => {
      if ((thread.open || session.phase === "typing") && session.draft.trim())
        void session.submit(session.draft);
      else if (thread.open)
        host.current
          ?.querySelector<HTMLTextAreaElement>("textarea")
          ?.focus({ preventScroll: true });
      else if (session.phase === "typing") openThread();
      else open();
    },
    onListening: session.listen,
    onSend: (words) => {
      void session.submit(words);
    },
    onCancel: session.cancelVoice,
    onFailure: session.reportVoiceFailure,
  });
  const close = () => {
    voice.cancel();
    setAssistantThreadOpen(false);
    if (session.phase === "review") session.acknowledge();
    else session.close();
    orb.current?.focus({ preventScroll: true });
  };
  const minimize = () => {
    setAssistantMinimized(true);
    orb.current?.focus({ preventScroll: true });
  };
  const dismissOutside = () => {
    if (compact && session.phase === "working") {
      minimize();
      return;
    }
    close();
    if (position === "workspace") clearSelection();
  };
  const showExchange = (id: string) => {
    if (!assistantThreadActionAvailability(id).canShow) return;
    close();
    showAssistantThreadExchange(id);
  };
  let orbHandlers: OrbGestureHandlers =
    voice.voiceActive &&
    (voice.mode === "tap" || voice.phase === "transcribing")
      ? voice.tapHandlers
      : voice.handlers;
  if (minimized) orbHandlers = { onClick: () => setAssistantMinimized(false) };
  else if (working) orbHandlers = { onClick: session.stop };

  useEffect(() => {
    if (!active) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (compact && session.phase === "working") minimize();
        else close();
      }
      if (event.key !== "Tab") return;
      const selector =
        'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),[tabindex="0"]';
      const controls = [
        ...Array.from(
          host.current?.querySelectorAll<HTMLElement>(selector) ?? [],
        ),
        ...Array.from(
          document.querySelectorAll<HTMLElement>(
            thread.open
              ? `[data-assistant-playback] button:not(:disabled), [data-player-playback] button:not(:disabled), [data-notification-root] button:not(:disabled)`
              : `[data-notification-root] button:not(:disabled)`,
          ),
        ),
      ].filter(
        (element) =>
          element.getClientRects().length > 0 &&
          !element.closest("[inert]") &&
          element.getAttribute("aria-disabled") !== "true" &&
          getComputedStyle(element).visibility !== "hidden",
      );
      if (!controls.length) return;
      const current = controls.indexOf(document.activeElement as HTMLElement);
      const next =
        current < 0
          ? event.shiftKey
            ? controls.length - 1
            : 0
          : (current + (event.shiftKey ? -1 : 1) + controls.length) %
            controls.length;
      event.preventDefault();
      controls[next].focus({ preventScroll: true });
    };
    window.addEventListener("keydown", key, true);
    const outside = (event: PointerEvent) => {
      if (
        !thread.open ||
        !(event.target instanceof Element) ||
        host.current?.contains(event.target) ||
        event.target.closest(
          "[data-assistant-playback], [data-player-playback], [data-notification-root]",
        )
      )
        return;
      close();
    };
    document.addEventListener("pointerdown", outside, true);
    return () => {
      window.removeEventListener("keydown", key, true);
      document.removeEventListener("pointerdown", outside, true);
    };
  });

  const orbView = (
    <OrbAssistantView
      hasSavedTask={Boolean(hasSavedTask)}
      reviewSummary={lastExchange?.summary}
      canUndoReview={reviewActions?.canUndo}
      onUndoReview={
        reviewActions && lastExchange
          ? () => {
              undoAssistantThreadExchange(lastExchange.id);
              session.acknowledge();
            }
          : undefined
      }
      onCompareReview={
        reviewActions?.canUndo && before && comparisonTarget
          ? setComparing
          : undefined
      }
      phase={working ? "working" : session.phase}
      minimized={minimized}
      threadOpen={thread.open}
      inThreadComposer={thread.open && position === "workspace"}
      exchangeCount={thread.items.length}
      onOpenThread={openThread}
      target={session.target}
      voiceSide={session.voiceSide}
      voicePhase={voice.phase}
      voiceMode={voice.mode}
      draft={session.draft}
      onDraftChange={session.setDraft}
      transcript={session.transcript}
      progress={session.progress}
      answer={session.answer}
      suggestions={session.suggestions}
      onSubmit={() => {
        void session.submit(session.draft);
      }}
      onClose={dismissOutside}
      onDone={() => {
        session.acknowledge();
        orb.current?.focus({ preventScroll: true });
      }}
      onEditRequest={session.editRequest}
      onSuggestion={(words) => {
        void session.submit(words);
      }}
      orbHandlers={orbHandlers}
      orbRef={orb}
      toolbarHeight={placement.toolbarHeight}
      placement={position}
      availableHeight={placement.availableHeight}
    />
  );

  const view = (
    <div
      ref={host}
      className={
        position === "toolbar"
          ? styles.toolbarHost
          : position === "floating"
            ? styles.floatingHost
            : styles.host
      }
      style={position === "workspace" ? { top: placement.top } : undefined}
      data-assistant-region
      data-active={active}
      data-assistant-focus={active && !thread.open && !comparing}
    >
      {session.available && (
        <>
          {thread.open && position === "workspace" && (
            <button
              type="button"
              className={styles.threadDone}
              data-thread-done
              title={mode === "design" ? "Back to design" : "Back to timeline"}
              onClick={close}
            >
              Done
            </button>
          )}
          {thread.open && (
            <div
              className={
                position === "workspace"
                  ? styles.threadDock
                  : styles.threadPopover
              }
              style={
                position !== "workspace"
                  ? { maxHeight: Math.max(160, placement.availableHeight - 66) }
                  : undefined
              }
            >
              <div className={styles.threadContent}>
                <AssistantThread
                  variant={position === "workspace" ? "phone" : "desktop"}
                  keyboardOpen={threadKeyboardOpen}
                  savedTask={hasSavedTask ? <SavedTaskPanel /> : null}
                  orb={position === "workspace" ? orbView : undefined}
                  targetLabel={
                    session.target
                      ? session.target.type[0].toUpperCase() +
                        session.target.type.slice(1)
                      : undefined
                  }
                  attachments={
                    <AssistantAttachments
                      layout={position === "workspace" ? "composer" : "inline"}
                      disabled={
                        session.phase === "working" ||
                        session.phase === "listening"
                      }
                    />
                  }
                  timeline={
                    mode === "timeline" ? (
                      <AssistantMiniTimeline folded={threadKeyboardOpen} />
                    ) : undefined
                  }
                  items={thread.items}
                  collapsed={threadKeyboardOpen || thread.collapsed}
                  draft={session.draft}
                  composeEnabled={
                    (session.phase === "typing" || session.phase === "idle") &&
                    !threadPending
                  }
                  autoFocus={session.phase === "typing" && !threadPending}
                  busy={
                    session.phase === "working" ||
                    threadPending ||
                    session.readingAttachments
                  }
                  onDraftChange={session.setDraft}
                  onSubmit={() => {
                    void session.submit(session.draft);
                  }}
                  onClose={close}
                  onToggleCollapsed={() =>
                    setAssistantThreadCollapsed(!thread.collapsed)
                  }
                  onUndo={(id) => {
                    undoAssistantThreadExchange(id);
                  }}
                  onRedo={(id) => {
                    redoAssistantThreadExchange(id);
                  }}
                  onShow={showExchange}
                  canUndo={(item) =>
                    assistantThreadActionAvailability(item.id).canUndo
                  }
                  canRedo={(item) =>
                    assistantThreadActionAvailability(item.id).canRedo
                  }
                  canShow={(item) =>
                    assistantThreadActionAvailability(item.id).canShow
                  }
                  actionHint={(item) =>
                    assistantThreadActionAvailability(item.id).message
                  }
                />
              </div>
            </div>
          )}
          {comparing &&
            reviewActions?.canUndo &&
            before &&
            comparisonTarget &&
            lastExchange && (
              <AssistantComparison
                project={before}
                sceneId={lastExchange.sceneId}
                time={lastExchange.at}
                target={comparisonTarget}
              />
            )}
          {!(thread.open && position === "workspace") && orbView}
        </>
      )}
    </div>
  );
  return portalTarget ? createPortal(view, portalTarget) : view;
}
