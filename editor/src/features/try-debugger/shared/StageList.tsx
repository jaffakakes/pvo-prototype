import type { DebugStage } from "../../../domain/debugging/types";
import { DebugIcon } from "./DebugIcon";
import { formatVideoTime } from "./format";
import styles from "../TryDebugger.module.css";

const stageIcons = {
  ok: "check",
  fail: "close",
  warn: "warn",
  ignored: "ignored",
  wait: "clock",
  running: "clock",
  next: "minus",
} as const;

export function StageList({ stages, density }: { stages: DebugStage[]; density: "desktop" | "mobile" }) {
  let lastConfirmed = -1;
  for (let index = stages.length - 1; index >= 0; index -= 1) {
    if (stages[index]?.kind !== "next") { lastConfirmed = index; break; }
  }
  return <section className={styles.stages} aria-label="What happened in order" data-density={density}>
    <h3>In order · video time</h3>
    <ol>
      {stages.map((stage, index) => <li key={stage.id} className={styles.stageRow}
        data-kind={stage.kind} data-last={index === lastConfirmed}>
        <span className={styles.stageNode}>
          {stage.kind === "running" ? <span className={styles.spinner} aria-hidden="true" />
            : stage.kind === "next" ? null : <DebugIcon name={stageIcons[stage.kind]} size={11} />}
        </span>
        <span className={styles.stageTime}>{formatVideoTime(stage.videoTime)}</span>
        <span className={styles.stageWords}><strong>{stage.label}</strong>{stage.detail && <small>{stage.detail}</small>}</span>
      </li>)}
    </ol>
  </section>;
}
