import { DebugIcon } from "./shared/DebugIcon";
import styles from "./TryDebugger.module.css";

export type DebugButtonProps = {
  variant: "desktop" | "mobile" | "lastRun";
  open: boolean;
  onClick: () => void;
  errorCount: number;
  hasLastRun: boolean;
};

export function DebugButton({ variant, open, onClick, errorCount, hasLastRun }: DebugButtonProps) {
  const label = variant === "lastRun" || hasLastRun ? "Last run" : "Debug";
  const ariaLabel = errorCount > 0 ? `${label}, ${errorCount} ${errorCount === 1 ? "error" : "errors"}` : label;
  return <button type="button" className={styles.debugButton} data-variant={variant} data-open={open}
    aria-label={ariaLabel} aria-pressed={open} onClick={onClick}>
    <DebugIcon name="activity" size={14} />
    <span>{label}</span>
    {errorCount > 0 && <span className={styles.errorBadge} aria-hidden="true">{errorCount}</span>}
    <span className={styles.srOnly} aria-live="polite">{open ? "Debug open" : "Debug closed"}</span>
  </button>;
}
