import type { CSSProperties } from "react";
import { Icon } from "../../ui/Icon";
import type { AssistantAnswer } from "../../domain/assistant/model";
import styles from "./AssistantReview.module.css";
import { AssistantAnswerText } from "./AssistantAnswerText";

interface AssistantReviewProps {
  answer: AssistantAnswer;
  suggestions: string[];
  disabled: boolean;
  onDone(): void;
  onEditRequest(): void;
  onSuggestion(suggestion: string): void;
}

function FollowUpGlyph({ suggestion }: { suggestion: string }) {
  const path = suggestion === "Softer colours" ? "M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"
    : suggestion === "Larger heading" ? "M4 20 10 4l6 16M6 14h8M19 4v8M16 7l3-3 3 3"
    : suggestion === "Bolder" ? "M7 4h6a4 4 0 0 1 0 8H7zM7 12h7a4 4 0 0 1 0 8H7z"
    : "m12 3 2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2z";
  return <svg className={styles.glyph} width="13" height="13" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={path} />
  </svg>;
}

export function AssistantReview({
  answer, suggestions, disabled, onDone, onEditRequest, onSuggestion,
}: AssistantReviewProps) {
  return <>
    <section className={styles.review} aria-label="Assistant answer" data-assistant-review>
      <div className={styles.reviewBody} tabIndex={0} role="region" aria-label="Request and answer">
        <button type="button" className={styles.request} aria-label="Edit request" onClick={onEditRequest} disabled={disabled}>
          <span className={styles.spark} aria-hidden="true">✦</span>
          <span className={styles.requestContent}>
            <span>{answer.request}</span>

          </span>
          <Icon name="pencil" size={14} />
        </button>
        <p className={styles.summary} role="status"><AssistantAnswerText text={answer.message} /></p>
        {answer.observations.length > 0 && <p className={styles.skipped}>{answer.observations.join(" · ")}</p>}
      </div>
      <div className={styles.reviewActions}>
        <button type="button" className={styles.keep} disabled={disabled} onClick={onDone}>
          <Icon name="check" size={15} /> Done
        </button>

      </div>
    </section>
    <div className={styles.followUps} aria-label="Try another change" data-assistant-follow-ups>
      {suggestions.slice(0, 3).map((suggestion, index) => <button
        type="button"
        className={styles.followUp}
        key={`${suggestion}-${index}`}
        disabled={disabled}
        onClick={() => onSuggestion(suggestion)}
        style={{ "--chip-order": index } as CSSProperties}
      >
        <FollowUpGlyph suggestion={suggestion} /><span>{suggestion}</span>
      </button>)}
    </div>
  </>;
}
