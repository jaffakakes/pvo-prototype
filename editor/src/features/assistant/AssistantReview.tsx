import type { CSSProperties } from "react";
import { Icon } from "../../ui/Icon";
import type { AssistantAnswer } from "../../domain/assistant/model";
import styles from "./AssistantReview.module.css";
import { AssistantAnswerText } from "./AssistantAnswerText";

interface AssistantReviewProps {
  answer: AssistantAnswer;
  suggestions: string[];
  earlierCount: number;
  summary?: string;
  canUndo?: boolean;
  onUndo?(): void;
  onCompare?(active: boolean): void;
  onOpenThread?(): void;
  disabled: boolean;
  onDone(): void;
  onEditRequest(): void;
  onSuggestion(suggestion: string): void;
}

export function AssistantReview({
  answer,
  summary,
  canUndo,
  onUndo,
  onCompare,
  suggestions,
  earlierCount,
  onOpenThread,
  disabled,
  onDone,
  onEditRequest,
  onSuggestion,
}: AssistantReviewProps) {
  return (
    <>
      <section
        className={styles.review}
        aria-label="Assistant answer"
        data-assistant-review
      >
        {earlierCount > 0 && onOpenThread && (
          <button
            className={styles.earlier}
            onClick={onOpenThread}
            type="button"
          >
            {earlierCount} earlier{" "}
            {earlierCount === 1 ? "exchange" : "exchanges"} ·{" "}
            <strong>Show</strong>
          </button>
        )}
        <div
          className={styles.reviewBody}
          tabIndex={0}
          role="region"
          aria-label="Request and answer"
        >
          <button
            type="button"
            className={styles.request}
            aria-label="Edit request"
            onClick={onEditRequest}
            disabled={disabled}
          >
            <span className={styles.youAvatar} aria-hidden="true">
              <Icon name="user" size={12} />
            </span>
            <span className={styles.requestContent}>
              <span>{answer.request}</span>
            </span>
            <Icon name="pencil" size={14} />
          </button>
          <div className={styles.replyRow}>
            <span className={styles.restyleAvatar} aria-hidden="true">
              <img src="restyle-mark.png" alt="" />
            </span>
            <div className={styles.reply}>
              <p className={styles.summary} role="status">
                <AssistantAnswerText text={answer.message} />
              </p>
              {summary && <p className={styles.changeSummary}>{summary}</p>}
              {answer.observations.length > 0 && (
                <p className={styles.skipped}>
                  {answer.observations.join(" · ")}
                </p>
              )}
            </div>
          </div>
        </div>
        <div className={styles.reviewActions}>
          <button
            type="button"
            className={styles.keep}
            disabled={disabled}
            onClick={onDone}
          >
            Keep
          </button>
          {onCompare && (
            <button
              type="button"
              className={styles.quiet}
              disabled={disabled}
              aria-label="Before — hold to compare"
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                onCompare(true);
              }}
              onPointerUp={() => onCompare(false)}
              onPointerCancel={() => onCompare(false)}
              onLostPointerCapture={() => onCompare(false)}
              onKeyDown={(event) => {
                if (event.key === " " || event.key === "Enter") {
                  event.preventDefault();
                  onCompare(true);
                }
              }}
              onKeyUp={() => onCompare(false)}
              onBlur={() => onCompare(false)}
            >
              Before
            </button>
          )}
          {onUndo && (
            <button
              type="button"
              className={styles.quiet}
              disabled={disabled || !canUndo}
              onClick={onUndo}
            >
              Undo
            </button>
          )}
        </div>
      </section>
      {suggestions.length > 0 && (
        <div
          className={styles.followUps}
          aria-label="Try another change"
          data-assistant-follow-ups
        >
          {suggestions.slice(0, 3).map((suggestion, index) => (
            <button
              type="button"
              className={styles.followUp}
              key={`${suggestion}-${index}`}
              disabled={disabled}
              onClick={() => onSuggestion(suggestion)}
              style={{ "--chip-order": index } as CSSProperties}
            >
              <span>{suggestion}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
