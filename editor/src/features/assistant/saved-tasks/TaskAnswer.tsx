import { ManualAlternative } from "./ManualAlternative";
import { useId, useState } from "react";
import {
  TASK_LIMITS,
  type TaskQuestion,
} from "../../../../../packages/pvo-assistant/tasks/index.js";
import styles from "./SavedTaskPanel.module.css";

export function TaskAnswer({
  question,
  busy,
  answer,
}: {
  question: TaskQuestion;
  busy: boolean;
  answer(id: string, value: string): void;
}) {
  const [value, setValue] = useState("");
  const inputId = useId();
  const valid =
    value.trim().length > 0 &&
    new TextEncoder().encode(value.trim()).byteLength <=
      TASK_LIMITS.answerBytes;
  return (
    <form
      className={styles.answer}
      onSubmit={(event) => {
        event.preventDefault();
        if (valid && !busy) answer(question.id, value.trim());
      }}
    >
      {question.alternative && (
        <ManualAlternative proposal={question.alternative} />
      )}
      <label htmlFor={inputId}>{question.prompt}</label>
      {question.choices.length > 0 && (
        <div className={styles.choices} aria-label="Suggested answers">
          {question.choices.map((choice) => (
            <button
              type="button"
              key={choice}
              disabled={busy}
              aria-pressed={value === choice}
              onClick={() => setValue(choice)}
            >
              {choice}
            </button>
          ))}
        </div>
      )}
      <textarea
        id={inputId}
        value={value}
        maxLength={TASK_LIMITS.answerBytes}
        disabled={busy}
        placeholder="Your answer…"
        rows={3}
        onChange={(event) => setValue(event.currentTarget.value)}
      />
      <button type="submit" disabled={!valid || busy}>
        Save answer
      </button>
    </form>
  );
}
