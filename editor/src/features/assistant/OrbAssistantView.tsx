import type { ButtonHTMLAttributes, CSSProperties, Ref } from "react";
import type { AssistantAnswer } from "../../domain/assistant/model";
import type { PvoComponent } from "../../domain/project/model";
import { Icon } from "../../ui/Icon";
import { fmt } from "../../ui/formatTime";
import { AssistantContext } from "./AssistantContext";
import { AssistantReview } from "./AssistantReview";
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
  disabled = false, toolbarHeight = 100,
  orbRef, orbHandlers, onSubmit, onClose, onDone, onEditRequest, onSuggestion,
  placement = "workspace", availableHeight = 500,
}: OrbAssistantViewProps) {
  const active = phase !== "idle";
  const dismissible = phase === "typing" || phase === "listening";
  const targetLabel = target ? `${target.type} ${fmt(target.at)}` : "project";
  const workingLabel = progress || "Reading your project…";
  const rootStyle = {
    "--assistant-toolbar-height": `${toolbarHeight}px`,
    "--assistant-available-height": `${availableHeight}px`,
  } as CSSProperties;

  return <div className={`orbAssistant ${styles.root} ${quickStyles.root} ${desktopStyles.root}`} data-assistant-phase={phase}
    data-has-target={!!target} data-voice-side={voiceSide} data-placement={placement} style={rootStyle}>
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
        role={phase === "working" ? "status" : undefined}
        aria-live={phase === "working" ? "polite" : undefined} aria-atomic="true"
        title={phase === "working" ? workingLabel : undefined}>
        {phase === "listening" ? placement === "toolbar" ? "Listening…" : `Listening · ${targetLabel}` : workingLabel}
      </div>
      <p role={phase === "listening" ? "status" : undefined}
        aria-live={phase === "listening" ? "polite" : undefined} data-assistant-live-content>
        {phase === "listening" ? transcript || "What would you like to change?" : draft}
        {phase === "listening" && <span className={styles.cursor} aria-hidden="true" />}
      </p>
      <span className={styles.status} data-assistant-live-status>
        {phase === "listening"
          ? "Let go to send · you can undo changes"
          : "Request in progress · tap Stop to cancel"}
      </span>
    </div>}

    {phase === "review" && answer && <AssistantReview answer={answer} suggestions={suggestions}
      disabled={disabled} onDone={onDone} onEditRequest={onEditRequest} onSuggestion={onSuggestion} />}

    <button {...orbHandlers} ref={orbRef} type="button" className={styles.orb}
      aria-label={phase === "working" ? "Stop request" : "Restyle assistant — tap to type, hold to speak, let go to send"}
      title={phase === "working" ? "Stop request and return to your message" : undefined}
      aria-disabled={phase === "review" || undefined} aria-expanded={active}
      aria-busy={phase === "working"} disabled={disabled} data-assistant-orb>
      {phase === "working" ? <span className={styles.stopLabel} aria-hidden="true" data-assistant-stop>
        <span className={styles.stopIcon} />Stop
      </span> : <img src="restyle-mark.png" alt="" draggable={false} />}
      <span className={styles.orbRing} aria-hidden="true" data-assistant-orb-ring />
    </button>
  </div>;
}
