import type { CSSProperties } from "react";
import { Icon } from "../../ui/Icon";
import type { AssistantProposal } from "./OrbAssistantView";
import styles from "./AssistantReview.module.css";

interface AssistantReviewProps {
  proposal: AssistantProposal;
  before: boolean;
  disabled: boolean;
  modeLabel: string;
  onKeep(): void;
  onUndo(): void;
  onEditRequest(): void;
  onBefore(active: boolean): void;
  onSuggestion(suggestion: string): void;
}

export function AssistantReview({
  proposal, before, disabled, modeLabel, onKeep, onUndo, onEditRequest, onBefore, onSuggestion,
}: AssistantReviewProps) {
  return <>
    <section className={styles.review} aria-label="Review assistant change" data-before={before}>
      <div className={styles.reviewBody} tabIndex={0} role="region" aria-label="Request and changes">
        <button type="button" className={styles.request} aria-label="Edit request" onClick={onEditRequest} disabled={disabled}>
          <span className={styles.spark} aria-hidden="true">✦</span>
          <span>{proposal.request}</span>
          <Icon name="pencil" size={14} />
        </button>
        {proposal.tags.length > 0 && <ul className={styles.tags} aria-label="Requested changes">
          {proposal.tags.map((tag, index) => <li key={`${tag}-${index}`}>+ {tag}</li>)}
        </ul>}
        <p className={styles.summary} role="status">{proposal.summary}</p>
        {proposal.skipped.length > 0 && <p className={styles.skipped}>{proposal.skipped.join(" · ")}</p>}
        <span className={styles.mode}>{modeLabel}</span>
      </div>
      <div className={styles.reviewActions}>
        <button type="button" className={styles.keep} disabled={disabled} onClick={onKeep}>
          <Icon name="check" size={17} /> Keep
        </button>
        <button
          type="button"
          className={styles.before}
          aria-label="Hold to view before"
          title="Hold to compare with the original"
          aria-pressed={before}
          disabled={disabled}
          onPointerDown={event => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            onBefore(true);
          }}
          onPointerUp={event => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
            onBefore(false);
          }}
          onPointerCancel={() => onBefore(false)}
          onLostPointerCapture={() => onBefore(false)}
          onBlur={() => onBefore(false)}
          onKeyDown={event => {
            if (event.key !== " " && event.key !== "Enter") return;
            event.preventDefault();
            if (!event.repeat) onBefore(true);
          }}
          onKeyUp={event => {
            if (event.key !== " " && event.key !== "Enter") return;
            event.preventDefault();
            onBefore(false);
          }}
        >
          <span>Before</span><small>hold</small>
        </button>
        <button type="button" className={styles.undo} disabled={disabled} onClick={onUndo}>
          <Icon name="undo" size={16} /> Undo
        </button>
      </div>
    </section>
    <div className={styles.followUps} aria-label="Try another change">
      {proposal.followUps.slice(0, 3).map((suggestion, index) => <button
        type="button"
        className={styles.followUp}
        key={`${suggestion}-${index}`}
        disabled={disabled}
        onClick={() => onSuggestion(suggestion)}
        style={{ "--chip-order": index } as CSSProperties}
      >
        <span className={styles.glyph} aria-hidden="true">{["✦", "↗", "◆"][index]}</span><span>{suggestion}</span>
      </button>)}
    </div>
  </>;
}
