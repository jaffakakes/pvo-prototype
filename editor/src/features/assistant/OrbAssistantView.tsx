import type { ButtonHTMLAttributes, CSSProperties, Ref } from "react";
import type { PvoComponent } from "../../domain/project/model";
import { Icon } from "../../ui/Icon";
import { fmt } from "../../ui/formatTime";
import { AssistantContext } from "./AssistantContext";
import { AssistantReview } from "./AssistantReview";
import styles from "./OrbAssistant.module.css";

export type AssistantPhase = "idle" | "typing" | "listening" | "working" | "review";
export type AssistantPlacement = "workspace" | "toolbar" | "floating";

export interface AssistantProposal {
  request: string;
  summary: string;
  tags: string[];
  skipped: string[];
  followUps: string[];
}

export type OrbGestureHandlers = Pick<ButtonHTMLAttributes<HTMLButtonElement>,
  "onClick" | "onPointerDown" | "onPointerUp" | "onPointerCancel" |
  "onLostPointerCapture" | "onKeyDown" | "onKeyUp" | "onBlur" | "onContextMenu">;

export interface OrbAssistantViewProps {
  phase: AssistantPhase;
  target: PvoComponent | null;
  draft: string;
  onDraftChange(value: string): void;
  transcript: string;
  proposal: AssistantProposal | null;
  before: boolean;
  disabled?: boolean;
  modeLabel?: string;
  toolbarHeight?: number;
  placement?: AssistantPlacement;
  availableHeight?: number;
  orbRef?: Ref<HTMLButtonElement>;
  orbHandlers: OrbGestureHandlers;
  onSubmit(): void;
  onClose(): void;
  onKeep(): void;
  onUndo(): void;
  onEditRequest(): void;
  onBefore(active: boolean): void;
  onSuggestion(suggestion: string): void;
}

export function OrbAssistantView({
  phase, target, draft, onDraftChange, transcript, proposal, before,
  disabled = false, modeLabel = "PVO assistant", toolbarHeight = 100,
  orbRef, orbHandlers, onSubmit, onClose, onKeep, onUndo, onEditRequest, onBefore, onSuggestion,
  placement = "workspace", availableHeight = 500,
}: OrbAssistantViewProps) {
  const active = phase !== "idle";
  const dismissible = phase === "typing" || phase === "listening";
  const targetLabel = target ? `${target.type} ${fmt(target.at)}` : "component";
  const rootStyle = {
    "--assistant-toolbar-height": `${toolbarHeight}px`,
    "--assistant-available-height": `${availableHeight}px`,
  } as CSSProperties;

  return <div className={`orbAssistant ${styles.root}`} data-assistant-phase={phase}
    data-has-target={!!target} data-placement={placement} style={rootStyle}>
    {dismissible && <button type="button" className={styles.dismissArea}
      data-assistant-dismiss-area aria-label="Close assistant" tabIndex={-1} onClick={onClose} />}

    {phase === "typing" && <>
      {target && <AssistantContext component={target} />}
      <form className={styles.composer} onSubmit={event => {
        event.preventDefault();
        if (!disabled && draft.trim()) onSubmit();
      }}>
        <input aria-label="Describe a change" autoComplete="off" autoFocus
          disabled={disabled} maxLength={2000}
          onChange={event => onDraftChange(event.currentTarget.value)}
          placeholder="Type a change… or hold the orb to speak" value={draft} />
        <button type="submit" aria-label="Send request" disabled={disabled || !draft.trim()}>
          <Icon name="arrow" size={20} />
        </button>
      </form>
    </>}

    {(phase === "listening" || phase === "working") && <div className={styles.liveBubble}>
      <div className={styles.liveHeading}>
        {phase === "listening" ? `Listening · ${targetLabel}` : "Working on it"}
        <span className={styles.mode}>{modeLabel}</span>
      </div>
      <p role="status" aria-live="polite">
        {phase === "listening" ? transcript || "What would you like to change?" : draft}
        {phase === "listening" && <span className={styles.cursor} aria-hidden="true" />}
      </p>
      <span className={styles.status}>
        {phase === "listening"
          ? "Let go to send · the change is drawn for review, not kept"
          : "Mapping to Structure · Style · Logic — approved actions only"}
      </span>
    </div>}

    {phase === "review" && proposal && <AssistantReview proposal={proposal} before={before}
      disabled={disabled} modeLabel={modeLabel} onKeep={onKeep} onUndo={onUndo}
      onEditRequest={onEditRequest} onBefore={onBefore} onSuggestion={onSuggestion} />}

    <button {...orbHandlers} ref={orbRef} type="button" className={styles.orb}
      aria-label="Restyle assistant — tap to type, hold to speak, let go to send"
      aria-disabled={phase === "review" || undefined} aria-expanded={active}
      aria-busy={phase === "working"} disabled={disabled || phase === "working"} data-assistant-orb>
      <img src="restyle-mark.png" alt="" draggable={false} />
      <span className={styles.orbRing} aria-hidden="true" />
    </button>
  </div>;
}
