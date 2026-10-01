import type { DebugResult } from "../../../domain/debugging/types";
import { DebugIcon } from "./DebugIcon";
import styles from "../TryDebugger.module.css";

const icons = {
  done: "check",
  failed: "close",
  unavailable: "close",
  no_action: "warn",
  blocked: "block",
  held: "pause",
  waiting: "clock",
  running: "clock",
  ignored: "ignored",
  cancelled: "minus",
  stopped: "stop",
} as const;

export function ResultChip({ result, label, large = false, neutral = false }: { result: DebugResult; label: string; large?: boolean; neutral?: boolean }) {
  return <span className={styles.resultChip} data-result={result} data-large={large} data-neutral={neutral}>
    {result === "running" ? <span className={styles.spinner} aria-hidden="true" /> : <DebugIcon name={icons[result]} size={11} />}
    <span>{label}</span>
  </span>;
}
