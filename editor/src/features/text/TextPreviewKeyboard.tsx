import { useEffect, useState, useSyncExternalStore } from "react";
import type { TextInputAction } from "../../domain/text/input";
import styles from "./TextPreviewKeyboard.module.css";

const touchPointer = window.matchMedia("(any-pointer: coarse)");
const subscribe = (listener: () => void) => {
  touchPointer.addEventListener("change", listener);
  return () => touchPointer.removeEventListener("change", listener);
};

export function useDesktopTextKeyboard() {
  return useSyncExternalStore(subscribe, () => !touchPointer.matches);
}

export function TextPreviewKeyboard({
  capitalize,
  onEdit,
}: {
  capitalize: boolean;
  onEdit(action: TextInputAction): void;
}) {
  const [shift, setShift] = useState(capitalize);
  const [numbers, setNumbers] = useState(false);
  useEffect(() => setShift(capitalize), [capitalize]);
  const rows = numbers
    ? ["1234567890", "-/:;()£&@", ".,?!'"]
    : ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];
  const keys = (row: string) =>
    Array.from(row).map((key) => (
      <button
        type="button"
        key={key}
        tabIndex={-1}
        className={styles.key}
        aria-label={`Key ${key}`}
        onClick={() => {
          onEdit({ kind: "insert", value: shift ? key : key.toLowerCase() });
          setShift(false);
        }}
      >
        {key}
      </button>
    ));

  return (
    <div
      className={styles.keyboard}
      data-preview-keyboard
      role="group"
      aria-label="On-screen keyboard"
      onPointerDown={(event) => event.preventDefault()}
    >
      <div className={styles.row}>{keys(rows[0])}</div>
      <div className={`${styles.row} ${styles.middle}`}>{keys(rows[1])}</div>
      <div className={styles.row}>
        <button
          type="button"
          tabIndex={-1}
          className={`${styles.key} ${styles.modifier}`}
          aria-label="Shift"
          aria-pressed={shift}
          disabled={numbers}
          onClick={() => setShift(!shift)}
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill={shift ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth="1.7"
            aria-hidden="true"
          >
            <path d="M3 11 12 2l9 9h-6v10H9V11Z" />
          </svg>
        </button>
        {keys(rows[2])}
        <button
          type="button"
          tabIndex={-1}
          className={`${styles.key} ${styles.modifier}`}
          aria-label="Backspace"
          onClick={() => onEdit({ kind: "backspace" })}
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M8 5h13v14H8l-6-7ZM11 9l6 6m0-6-6 6" />
          </svg>
        </button>
      </div>
      <div className={styles.row}>
        <button
          type="button"
          tabIndex={-1}
          className={`${styles.key} ${styles.mode}`}
          aria-label={numbers ? "Letters" : "Numbers"}
          onClick={() => setNumbers(!numbers)}
        >
          {numbers ? "ABC" : "123"}
        </button>
        <button
          type="button"
          tabIndex={-1}
          className={`${styles.key} ${styles.space}`}
          aria-label="Space"
          onClick={() => onEdit({ kind: "insert", value: " " })}
        >
          space
        </button>
        <button
          type="button"
          tabIndex={-1}
          className={`${styles.key} ${styles.mode}`}
          aria-label="Return"
          onClick={() => onEdit({ kind: "insert", value: "\n" })}
        >
          <svg
            width="25"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M20 5v9H4m5-5-5 5 5 5" />
          </svg>
        </button>
      </div>
    </div>
  );
}
