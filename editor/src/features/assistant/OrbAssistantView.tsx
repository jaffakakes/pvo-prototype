import type { ButtonHTMLAttributes, CSSProperties, Ref } from "react";
import type { PvoComponent } from "../../domain/project/model";
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
  threadOpen: boolean;
  exchangeCount: number;
  changeCount: number;
  proposal: AssistantProposal | null;
  before: boolean;
  disabled?: boolean;
  modeLabel?: string;
  toolbarHeight?: number;
  placement?: AssistantPlacement;
  availableHeight?: number;
  orbRef?: Ref<HTMLButtonElement>;
  orbHandlers: OrbGestureHandlers;
  onKeep(): void;
  onUndo(): void;
  onEditRequest(): void;
  onBefore(active: boolean): void;
  onSuggestion(suggestion: string): void;
}

export function OrbAssistantView({
  phase, target, threadOpen, exchangeCount, changeCount, proposal, before,
  disabled = false, modeLabel = "PVO assistant", toolbarHeight = 100,
  orbRef, orbHandlers, onKeep, onUndo, onEditRequest, onBefore, onSuggestion,
  placement = "workspace", availableHeight = 500,
}: OrbAssistantViewProps) {
  const active = threadOpen || phase === "review";
  const rootStyle = {
    "--assistant-toolbar-height": `${toolbarHeight}px`,
    "--assistant-available-height": `${availableHeight}px`,
  } as CSSProperties;

  return <div className={`orbAssistant ${styles.root}`} data-assistant-phase={phase}
    data-has-target={!!target} data-placement={placement} data-thread-open={threadOpen} style={rootStyle}>
    {phase === "review" && proposal && <AssistantReview proposal={proposal} before={before}
      disabled={disabled} modeLabel={modeLabel} onKeep={onKeep} onUndo={onUndo}
      onEditRequest={onEditRequest} onBefore={onBefore} onSuggestion={onSuggestion} />}

    {threadOpen && placement === "toolbar" && <span className={styles.threadStatus}><i />Thread open · {changeCount} changes</span>}
    <button {...orbHandlers} ref={orbRef} type="button" className={styles.orb}
      aria-label="Restyle — tap for the thread, hold to speak, let go to send"
      aria-disabled={phase === "review" || undefined} aria-expanded={active}
      aria-busy={phase === "working"} disabled={disabled} data-assistant-orb>
      <img src="restyle-mark.png" alt="" draggable={false} />
      <span className={styles.orbRing} aria-hidden="true" />
      {exchangeCount > 0 && !threadOpen && phase !== "review" && <span className={styles.count} aria-label={`${exchangeCount} exchanges`}>{exchangeCount}</span>}
    </button>
  </div>;
}
