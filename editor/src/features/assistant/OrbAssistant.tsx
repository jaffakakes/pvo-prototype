import { SavedTaskPanel } from "./saved-tasks/SavedTaskPanel";
import { useAssistantScope } from "../../state/assistant/sessionScope";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { OrbAssistantView, type AssistantPlacement } from "./OrbAssistantView";
import { useAssistantSession } from "./useAssistantSession";
import { useAssistantPlacement } from "./useAssistantPlacement";
import { useOrbVoice } from "./voice/useOrbVoice";
import { AssistantThread } from "./thread/AssistantThread";
import {
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
import { total } from "../../domain/clips/timing";
import styles from "./AssistantHost.module.css";

export function OrbAssistant({
  placement: position = "workspace",
  portalTarget,
  threadKeyboardOpen = false,
}: {
  placement?: AssistantPlacement;
  portalTarget?: HTMLElement | null;
  threadKeyboardOpen?: boolean;
} = {}) {
  const session = useAssistantSession({
    inspectorVisible: position !== "workspace",
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
  const scenes = useCapture((state) => state.scenes);
  const ratio = useCapture((state) => state.ratio);
  const clips = scenes.flatMap((scene) => scene.clips);
  const host = useRef<HTMLDivElement>(null);
  const orb = useRef<HTMLButtonElement>(null);
  const placement = useAssistantPlacement(host, position, portalTarget);
  const active = session.available && (session.phase !== "idle" || thread.open);
  const threadPending = thread.items.some((item) => item.status === "pending");
  const open = () => {
    session.open();
    requestAnimationFrame(() =>
      host.current
        ?.querySelector<HTMLInputElement>("input")
        ?.focus({ preventScroll: true }),
    );
  };
  const openThread = () => {
    session.open();
    setAssistantThreadOpen(true);
  };
  const voice = useOrbVoice({
    contextKey: session.voiceContext,
    enabled:
      session.available &&
      session.phase !== "working" &&
      session.phase !== "review",
    onTap: open,
    onListening: session.listen,
    onSend: (words) => {
      setAssistantThreadOpen(false);
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
  const dismissOutside = () => {
    close();
    if (position === "workspace") clearSelection();
  };
  const startVoice = () => {
    setAssistantThreadOpen(false);
    voice.start();
    orb.current?.focus({ preventScroll: true });
  };
  const orbHandlers =
    session.phase === "working"
      ? { onClick: session.stop }
      : voice.voiceActive &&
          (voice.mode === "tap" || voice.phase === "transcribing")
        ? voice.tapHandlers
        : voice.handlers;

  useEffect(() => {
    if (!active) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
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
            `[data-notification-root] button:not(:disabled)`,
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
        event.target.closest("[data-thread-resize], [data-notification-root]")
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
    >
      {session.available && (
        <>
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
                  savedTask={hasSavedTask ? <SavedTaskPanel /> : null}
                  items={thread.items}
                  collapsed={threadKeyboardOpen || thread.collapsed}
                  draft={session.draft}
                  targetLabel={session.target?.type ?? null}
                  composeEnabled={
                    (session.phase === "typing" || session.phase === "idle") &&
                    !threadPending
                  }
                  autoFocus={session.phase === "typing" && !threadPending}
                  busy={session.phase === "working" || threadPending}
                  onDraftChange={session.setDraft}
                  onSubmit={() => {
                    void session.submit(session.draft);
                  }}
                  onStartVoice={startVoice}
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
                  onShow={(id) => {
                    if (!assistantThreadActionAvailability(id).canShow) return;
                    close();
                    showAssistantThreadExchange(id);
                  }}
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
          <OrbAssistantView
            hasSavedTask={Boolean(hasSavedTask)}
            phase={session.phase}
            threadOpen={thread.open}
            exchangeCount={thread.items.length}
            onOpenThread={openThread}
            target={session.target}
            clipCount={clips.length}
            duration={total(clips)}
            ratio={ratio}
            voiceSide={session.voiceSide}
            voicePhase={voice.phase}
            voiceMode={voice.mode}
            onStartVoice={startVoice}
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
        </>
      )}
    </div>
  );
  return portalTarget ? createPortal(view, portalTarget) : view;
}
