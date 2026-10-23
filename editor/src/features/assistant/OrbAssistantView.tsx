import type { ButtonHTMLAttributes, CSSProperties, Ref } from "react";
import type { AssistantAnswer } from "../../domain/assistant/model";
import type { PvoComponent } from "../../domain/project/model";
import { Icon } from "../../ui/Icon";
import { fmt } from "../../ui/formatTime";
import { AssistantReview } from "./AssistantReview";
import type { VoicePhase } from "./voice/voiceSession";
import type { VoiceMode } from "./voice/useOrbVoice";
import styles from "./OrbAssistant.module.css";
import quickStyles from "./AssistantQuickActions.module.css";
import desktopStyles from "./OrbAssistantDesktop.module.css";

export type AssistantPhase =
  "idle" | "typing" | "listening" | "working" | "review";
export type AssistantPlacement = "workspace" | "toolbar" | "floating";

export type OrbGestureHandlers = Pick<
  ButtonHTMLAttributes<HTMLButtonElement>,
  | "onClick"
  | "onPointerDown"
  | "onPointerUp"
  | "onPointerCancel"
  | "onLostPointerCapture"
  | "onKeyDown"
  | "onKeyUp"
  | "onBlur"
  | "onContextMenu"
>;

export interface OrbAssistantViewProps {
  phase: AssistantPhase;
  minimized?: boolean;
  threadOpen?: boolean;
  inThreadComposer?: boolean;
  exchangeCount?: number;
  hasSavedTask?: boolean;
  reviewSummary?: string;
  canUndoReview?: boolean;
  onUndoReview?(): void;
  onCompareReview?(active: boolean): void;
  onOpenThread?(): void;
  target: PvoComponent | null;
  voiceSide?: "left" | "right";
  voicePhase: VoicePhase;
  voiceMode: VoiceMode;
  draft: string;
  onDraftChange(value: string): void;
  transcript: string;
  progress: string;
  answer: AssistantAnswer | null;
  suggestions: string[];
  disabled?: boolean;
  toolbarHeight?: number;
  placement?: AssistantPlacement;
  availableHeight?: number;
  orbRef?: Ref<HTMLButtonElement>;
  orbHandlers: OrbGestureHandlers;
  onSubmit(): void;
  onClose(): void;
  onDone(): void;
  onEditRequest(): void;
  onSuggestion(suggestion: string): void;
}

export function OrbAssistantView({
  phase,
  minimized = false,
  threadOpen = false,
  inThreadComposer = false,
  exchangeCount = 0,
  hasSavedTask = false,
  reviewSummary,
  canUndoReview,
  onUndoReview,
  onCompareReview,
  onOpenThread,
  target,
  voiceSide = "right",
  draft,
  onDraftChange,
  transcript,
  progress,
  answer,
  suggestions,
  voicePhase,
  voiceMode,
  disabled = false,
  toolbarHeight = 100,
  orbRef,
  orbHandlers,
  onSubmit,
  onClose,
  onDone,
  onEditRequest,
  onSuggestion,
  placement = "workspace",
  availableHeight = 500,
}: OrbAssistantViewProps) {
  const active = phase !== "idle" && !minimized;
  const compactWorking =
    phase === "working" && placement === "workspace" && !threadOpen;
  const dismissible =
    !minimized &&
    !threadOpen &&
    (phase === "typing" || phase === "listening" || compactWorking);
  const targetLabel = target
    ? `${target.type[0].toUpperCase()}${target.type.slice(1)} · ${fmt(target.at)}`
    : "";
  const workingLabel = progress || "Reading your project…";
  const startingVoice = phase === "listening" && voicePhase === "starting";
  const transcribingVoice =
    phase === "listening" && voicePhase === "transcribing";
  const cancellableVoice = startingVoice || transcribingVoice;
  const tapVoice = phase === "listening" && voiceMode === "tap";
  const voiceHint = startingVoice
    ? "Allow microphone access when asked."
    : transcribingVoice
      ? "Transcribing…"
      : tapVoice
        ? "Tap the orb to send"
        : "Let go to send";
  let orbLabel =
    "Restyle assistant — tap to type, hold to speak, let go to send";
  let orbTitle: string | undefined;
  if (phase === "working") {
    orbLabel = minimized ? "Show request progress" : "Stop request";
    orbTitle = minimized
      ? "The assistant is still working"
      : "Stop request and return to your message";
  } else if (minimized && phase === "review") {
    orbLabel = "View assistant answer";
  } else if (tapVoice || transcribingVoice) {
    orbLabel = cancellableVoice ? "Cancel voice input" : "Send voice request";
    orbTitle = voiceHint;
  } else if ((phase === "typing" || threadOpen) && draft.trim()) {
    orbLabel = "Send request";
    orbTitle = "Send request · Hold to speak";
  } else if (phase === "typing" && !threadOpen) {
    orbLabel = "Open conversation — hold to speak";
  }
  const rootStyle = {
    "--assistant-toolbar-height": `${toolbarHeight}px`,
    "--assistant-available-height": `${availableHeight}px`,
  } as CSSProperties;

  return (
    <div
      className={`orbAssistant ${styles.root} ${desktopStyles.root}`}
      data-assistant-phase={phase}
      data-minimized={minimized}
      data-has-target={!!target}
      data-has-suggestions={suggestions.length > 0}
      data-voice-side={voiceSide}
      data-voice-phase={voicePhase}
      data-placement={placement}
      data-thread-open={threadOpen}
      data-in-thread-composer={inThreadComposer}
      style={rootStyle}
    >
      {dismissible && (
        <button
          type="button"
          className={styles.dismissArea}
          data-assistant-dismiss-area
          aria-label={compactWorking ? "Minimize assistant" : "Close assistant"}
          tabIndex={-1}
          onClick={onClose}
        />
      )}

      {phase === "typing" && !threadOpen && (
        <>
          <form
            className={styles.composer}
            data-assistant-composer
            onSubmit={(event) => {
              event.preventDefault();
              if (!disabled && draft.trim()) onSubmit();
            }}
          >
            <div className={styles.field} data-assistant-field>
              {target && (
                <span className={styles.targetChip} data-assistant-target>
                  {targetLabel}
                </span>
              )}
              <input
                aria-label="Describe a change"
                autoComplete="off"
                autoFocus
                disabled={disabled}
                maxLength={2000}
                onChange={(event) => onDraftChange(event.currentTarget.value)}
                placeholder="Ask anything"
                value={draft}
              />
            </div>
          </form>
          {suggestions.length > 0 &&
            !draft.trim() &&
            placement !== "toolbar" && (
              <div
                className={quickStyles.quickActions}
                aria-label="Suggested next steps"
              >
                {suggestions.map((suggestion) => (
                  <button
                    type="button"
                    key={suggestion}
                    disabled={disabled}
                    onClick={() => onSuggestion(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
        </>
      )}

      {!minimized &&
        (phase === "listening" || (phase === "working" && !threadOpen)) && (
          <div
            className={styles.liveBubble}
            data-assistant-live
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {phase === "working" ? (
              <>
                <div className={styles.liveContent} data-assistant-live-heading>
                  <span className={styles.spinner} aria-hidden="true" />
                  <span>{workingLabel}</span>
                </div>
                <p
                  className={styles.requestLine}
                  data-assistant-live-content
                  title={draft}
                >
                  “{draft}”
                </p>
              </>
            ) : (
              <>
                {!startingVoice && (
                  <div
                    className={styles.liveContent}
                    data-assistant-live-heading
                  >
                    <span className={styles.voiceDot} aria-hidden="true" />
                    <span data-assistant-transcript>
                      {transcript ||
                        (transcribingVoice ? "Transcribing…" : "Listening…")}
                      {voicePhase === "listening" && (
                        <span className={styles.cursor} aria-hidden="true" />
                      )}
                    </span>
                  </div>
                )}
                {!transcribingVoice && (
                  <p className={styles.hint} data-assistant-live-status>
                    {voiceHint}
                  </p>
                )}
              </>
            )}
          </div>
        )}

      {!minimized && !threadOpen && phase === "review" && answer && (
        <AssistantReview
          answer={answer}
          summary={reviewSummary}
          canUndo={canUndoReview}
          onUndo={onUndoReview}
          onCompare={onCompareReview}
          suggestions={suggestions}
          earlierCount={Math.max(0, exchangeCount - 1)}
          onOpenThread={onOpenThread}
          disabled={disabled}
          onDone={onDone}
          onEditRequest={onEditRequest}
          onSuggestion={onSuggestion}
        />
      )}

      <div className={styles.orbAnchor} data-assistant-orb-anchor>
        <button
          {...orbHandlers}
          onPointerDown={(event) => {
            if (
              inThreadComposer &&
              document.activeElement instanceof HTMLTextAreaElement
            )
              event.preventDefault();
            orbHandlers.onPointerDown?.(event);
          }}
          ref={orbRef}
          type="button"
          className={styles.orb}
          aria-label={orbLabel}
          title={orbTitle}
          aria-disabled={(phase === "review" && !minimized) || undefined}
          aria-expanded={active || threadOpen}
          aria-busy={phase === "working" || cancellableVoice}
          disabled={disabled}
          data-assistant-orb
        >
          {phase === "working" && !compactWorking ? (
            <span
              className={styles.stopIcon}
              aria-hidden="true"
              data-assistant-stop
            />
          ) : tapVoice || transcribingVoice ? (
            <Icon name={cancellableVoice ? "close" : "arrow"} size={22} />
          ) : (phase === "typing" || threadOpen) && draft.trim() ? (
            <Icon name="arrow" size={24} />
          ) : (
            <img src="restyle-mark.png" alt="" draggable={false} />
          )}
          <span
            className={styles.orbRing}
            aria-hidden="true"
            data-assistant-orb-ring
          />
        </button>
        {(exchangeCount > 0 || hasSavedTask) &&
          phase === "idle" &&
          !threadOpen &&
          onOpenThread && (
            <button
              type="button"
              className={styles.threadCount}
              aria-label={
                hasSavedTask
                  ? "Open saved task"
                  : `Open Restyle thread, ${exchangeCount} ${exchangeCount === 1 ? "exchange" : "exchanges"}`
              }
              title="Open Restyle thread"
              onClick={onOpenThread}
            >
              {hasSavedTask ? (
                "•"
              ) : (
                <>
                  {Math.min(exchangeCount, 9)}
                  {exchangeCount > 9 ? "+" : ""}
                </>
              )}
            </button>
          )}
      </div>
    </div>
  );
}
