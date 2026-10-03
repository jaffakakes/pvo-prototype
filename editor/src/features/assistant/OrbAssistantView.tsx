import type { ButtonHTMLAttributes, CSSProperties, Ref } from "react";
import type { AssistantAnswer } from "../../domain/assistant/model";
import type { PvoComponent } from "../../domain/project/model";
import { Icon } from "../../ui/Icon";
import { fmt } from "../../ui/formatTime";
import { AssistantContext } from "./AssistantContext";
import { AssistantReview } from "./AssistantReview";
import type { VoicePhase } from "./voice/voiceSession";
import type { VoiceMode } from "./voice/useOrbVoice";
import styles from "./OrbAssistant.module.css";
import quickStyles from "./AssistantQuickActions.module.css";
import desktopStyles from "./OrbAssistantDesktop.module.css";

export type AssistantPhase = "idle" | "typing" | "listening" | "working" | "review";
export type AssistantPlacement = "workspace" | "toolbar" | "floating";

export type OrbGestureHandlers = Pick<ButtonHTMLAttributes<HTMLButtonElement>,
  "onClick" | "onPointerDown" | "onPointerUp" | "onPointerCancel" |
  "onLostPointerCapture" | "onKeyDown" | "onKeyUp" | "onBlur" | "onContextMenu">;

export interface OrbAssistantViewProps {
  phase: AssistantPhase;
  target: PvoComponent | null;
  clipCount: number;
  duration: number;
  ratio: string;
  voiceSide?: "left" | "right";
  voicePhase: VoicePhase;
  voiceMode: VoiceMode;
  onStartVoice(): void;
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
  phase, target, clipCount, duration, ratio, voiceSide = "right", draft, onDraftChange, transcript, progress, answer, suggestions,
  voicePhase, voiceMode, onStartVoice,
  disabled = false, toolbarHeight = 100,
  orbRef, orbHandlers, onSubmit, onClose, onDone, onEditRequest, onSuggestion,
  placement = "workspace", availableHeight = 500,
}: OrbAssistantViewProps) {
  const active = phase !== "idle";
  const dismissible = phase === "typing" || phase === "listening";
  const targetLabel = target ? `${target.type} ${fmt(target.at)}` : "project";
  const workingLabel = progress || "Reading your project…";
  const startingVoice = phase === "listening" && voicePhase === "starting";
  const transcribingVoice = phase === "listening" && voicePhase === "transcribing";
  const cancellableVoice = startingVoice || transcribingVoice;
  const tapVoice = phase === "listening" && voiceMode === "tap";
  const voiceLabels: Record<VoicePhase, string> = {
    idle: "Sending…",
    starting: "Starting microphone…",
    listening: placement === "toolbar" ? "Listening…" : `Listening · ${targetLabel}`,
    ready: "Ready to send",
    transcribing: "Transcribing…",
  };
  const voiceHint = startingVoice ? "Allow microphone access when asked."
    : transcribingVoice ? "Turning your recording into words · Esc to cancel"
    : tapVoice ? "Tap Send when you're done · Esc to cancel"
      : "Let go to send · you can undo changes";
  let orbLabel = "Restyle assistant — tap to type, hold to speak, let go to send";
  let orbTitle: string | undefined;
  if (phase === "working") {
    orbLabel = "Stop request";
    orbTitle = "Stop request and return to your message";
  } else if (tapVoice || transcribingVoice) {
    orbLabel = cancellableVoice ? "Cancel voice input" : "Send voice request";
    orbTitle = voiceHint;
  }
  const rootStyle = {
    "--assistant-toolbar-height": `${toolbarHeight}px`,
    "--assistant-available-height": `${availableHeight}px`,
  } as CSSProperties;

  return <div className={`orbAssistant ${styles.root} ${quickStyles.root} ${desktopStyles.root}`} data-assistant-phase={phase}
    data-has-target={!!target} data-voice-side={voiceSide} data-voice-phase={voicePhase}
    data-placement={placement} style={rootStyle}>
    {dismissible && <button type="button" className={styles.dismissArea}
      data-assistant-dismiss-area aria-label="Close assistant" tabIndex={-1} onClick={onClose} />}

    {phase === "typing" && <>
      <AssistantContext component={target} clipCount={clipCount} duration={duration} />
      <form className={styles.composer} data-assistant-composer onSubmit={event => {
        event.preventDefault();
        if (!disabled && draft.trim()) onSubmit();
      }}>
        <input aria-label="Describe a change" autoComplete="off" autoFocus
          disabled={disabled} maxLength={2000}
          onChange={event => onDraftChange(event.currentTarget.value)}
          placeholder="Ask anything…" value={draft} />
        <button type="button" aria-label="Start voice input"
          title="Speak a request" disabled={disabled} onClick={onStartVoice}>
          <Icon name="microphone" size={18} />
        </button>
        <button type="submit" aria-label="Send request" disabled={disabled || !draft.trim()}>
          <Icon name="arrow" size={20} />
        </button>
      </form>
      {!target && placement !== "toolbar" && <div className={quickStyles.quickActions} aria-label="Whole edit suggestions">
        {[`Fit to ${ratio}`, "Add a title", "Summarize video"].map(suggestion => <button
          type="button" key={suggestion} disabled={disabled} onClick={() => onSuggestion(suggestion)}>
          <span aria-hidden="true">✦</span>{suggestion}
        </button>)}
      </div>}
    </>}

    {(phase === "listening" || phase === "working") && <div className={styles.liveBubble} data-assistant-live>
      <div className={styles.liveHeading} data-assistant-live-heading
        role="status" aria-live="polite" aria-atomic="true"
        title={phase === "working" ? workingLabel : voiceHint}>
        {phase === "listening" ? voiceLabels[voicePhase] : workingLabel}
      </div>
      <p role={phase === "listening" ? "status" : undefined}
        aria-live={phase === "listening" ? "polite" : undefined} data-assistant-live-content>
        {phase === "listening" ? transcript || (cancellableVoice ? "" : "What would you like to change?") : draft}
        {phase === "listening" && voicePhase === "listening" && <span className={styles.cursor} aria-hidden="true" />}
      </p>
      <span className={styles.status} data-assistant-live-status>
        {phase === "listening"
          ? voiceHint
          : "Request in progress · tap Stop to cancel"}
      </span>
    </div>}

    {phase === "review" && answer && <AssistantReview answer={answer} suggestions={suggestions}
      disabled={disabled} onDone={onDone} onEditRequest={onEditRequest} onSuggestion={onSuggestion} />}

    <button {...orbHandlers} ref={orbRef} type="button" className={styles.orb}
      aria-label={orbLabel} title={orbTitle}
      aria-disabled={phase === "review" || undefined} aria-expanded={active}
      aria-busy={phase === "working" || cancellableVoice} disabled={disabled} data-assistant-orb>
      {phase === "working" ? <span className={styles.stopLabel} aria-hidden="true" data-assistant-stop>
        <span className={styles.stopIcon} />Stop
      </span> : tapVoice || transcribingVoice ? <span className={styles.stopLabel} aria-hidden="true">
        <Icon name={cancellableVoice ? "close" : "arrow"} size={16} />{cancellableVoice ? "Cancel" : "Send"}
      </span> : <img src="restyle-mark.png" alt="" draggable={false} />}
      <span className={styles.orbRing} aria-hidden="true" data-assistant-orb-ring />
    </button>
  </div>;
}
