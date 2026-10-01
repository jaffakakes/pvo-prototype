import type { DebugReadiness } from "../../../domain/debugging/types";
import { DebugIcon } from "./DebugIcon";
import { formatVideoTime } from "./format";
import { ResultChip } from "./ResultChip";
import styles from "../TryDebugger.module.css";

function readinessLabel(item: DebugReadiness) {
  if (item.status === "active") return "Active now";
  if (item.status === "ended") return "Ended";
  if (item.status === "unavailable") return "Unavailable";
  return "Ready";
}

export function ReadinessList({ components, activeId, onSelect, density, overflow = 0 }: {
  components: DebugReadiness[];
  activeId: string;
  onSelect: (componentId: string) => void;
  density: "desktop" | "mobile";
  overflow?: number;
}) {
  if (components.length === 0) return <div className={styles.emptyCard}>No components in this run.</div>;
  return <div className={styles.readinessList} data-density={density}>
    {overflow > 0 && <div className={styles.omissionNote}>{overflow} additional component{overflow === 1 ? "" : "s"} omitted from this bounded view.</div>}
    {components.map(component => <button key={component.id} type="button" className={styles.readinessRow}
      aria-pressed={activeId === component.id} onClick={() => onSelect(component.id)}>
      <span className={styles.readinessTile}><DebugIcon name={component.code ? "code" : "sparkle"} size={14} /></span>
      <span className={styles.readinessText}>
        <strong>{component.name}</strong>
        <small>{component.type} · {formatVideoTime(component.at)}–{formatVideoTime(component.end)}{component.dispatch === "layer_end" ? " · at layer end" : ""}</small>
      </span>
      <span className={styles.readinessChips}>
        <ResultChip result={component.status === "active" ? "waiting" : component.status === "unavailable" ? "unavailable" : component.status === "ended" ? "stopped" : "done"}
          label={readinessLabel(component)} />
        {component.type === "tooltip" ? <ResultChip result="stopped" label="Display-only" />
          : !component.actionKnown ? <ResultChip result="stopped" label="Checking action…" />
            : <ResultChip result={component.hasAction ? "done" : "no_action"} label={component.hasAction ? "Action set" : "No action"} neutral={component.hasAction} />}
      </span>
    </button>)}
  </div>;
}
