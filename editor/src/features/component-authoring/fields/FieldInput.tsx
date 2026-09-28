import { useId, useRef } from "react";
import styles from "../NoCodeEditor.module.css";

/** One focused editing session contributes one history entry. */
export function FieldInput({ label, value, onChange, maxLength = 80, multiline = false, type = "text" }: {
  label: string;
  value: string;
  onChange: (value: string, undoable: boolean) => void;
  maxLength?: number;
  multiline?: boolean;
  type?: "text" | "url";
}) {
  const id = useId();
  const edited = useRef(false);
  const change = (next: string) => {
    if (next === value) return;
    onChange(next, !edited.current);
    edited.current = true;
  };
  const props = {
    id, value, maxLength,
    enterKeyHint: "done" as const,
    onFocus: () => { edited.current = false; },
    onBlur: () => { edited.current = false; },
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => change(event.target.value),
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (event.key === "Enter" && !multiline) {
        event.preventDefault();
        event.currentTarget.blur();
      }
    },
  };
  return <div className={styles.field}>
    <label htmlFor={id}>{label}</label>
    {multiline ? <textarea {...props} rows={3} /> : <input {...props} type={type} />}
  </div>;
}
