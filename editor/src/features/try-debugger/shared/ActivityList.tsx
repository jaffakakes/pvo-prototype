import { useEffect, useRef, type KeyboardEvent } from "react";
import type { DebugGroup } from "../../../domain/debugging/types";
import { DebugIcon } from "./DebugIcon";
import { formatVideoTime } from "./format";
import { ResultChip } from "./ResultChip";
import styles from "../TryDebugger.module.css";

type ActivityListProps = {
  groups: DebugGroup[];
  selectedId: string | null;
  density: "desktop" | "mobile";
  followLatest: boolean;
  listening: boolean;
  filtered: boolean;
  cleared: boolean;
  onSelect: (id: string) => void;
  onKeyboardSelect?: (id: string) => void;
  onResetFilters: () => void;
};

function ActivityRow({ group, selected, density, onSelect }: {
  group: DebugGroup;
  selected: boolean;
  density: "desktop" | "mobile";
  onSelect: () => void;
}) {
  const title = group.componentName || (group.kind === "playback" ? "Playback" : "Component");
  const icon = group.kind === "playback" ? "pause" : group.source ? "code" : "sparkle";
  if (group.kind === "session") {
    return <div className={styles.sessionRow} data-density={density}>
      <span className={styles.sessionTime}>{formatVideoTime(group.videoTime)}</span>
      <span className={styles.sessionTile}><DebugIcon name="stop" size={9} /></span>
      <span><strong>{title}</strong>{group.summary ? ` · ${group.summary}` : ""}</span>
    </div>;
  }
  return <button type="button" role="option" data-debug-row data-group-id={group.id} className={styles.activityRow}
    data-density={density} aria-selected={selected} onClick={onSelect}>
    <span className={styles.activityTime}>{formatVideoTime(group.videoTime)}</span>
    <span className={styles.activityTile} data-kind={group.kind}><DebugIcon name={icon} size={12} /></span>
    <span className={styles.activityTitle}><strong>{title}</strong>{group.target && <><span className={styles.titleDivider}> › </span><span>{group.target}</span></>}</span>
    <ResultChip result={group.result} label={group.resultLabel} />
    <span className={styles.activitySummary}>{group.summary}</span>
    {density === "mobile" && <DebugIcon name="chevron" size={14} className={styles.activityChevron} />}
  </button>;
}

export function ActivityList({ groups, selectedId, density, followLatest, listening, filtered, cleared, onSelect, onKeyboardSelect, onResetFilters }: ActivityListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const lastSequence = groups.at(-1)?.lastSequence;
  useEffect(() => {
    const list = listRef.current;
    if (followLatest && list) list.scrollTop = list.scrollHeight;
  }, [lastSequence, followLatest]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" && density === "desktop") {
      const current = event.currentTarget.querySelector<HTMLButtonElement>("[data-debug-row]:focus");
      if (current?.dataset.groupId) { event.preventDefault(); onSelect(current.dataset.groupId); }
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-debug-row]"));
    if (buttons.length === 0) return;
    const current = buttons.findIndex(button => button === document.activeElement);
    const next = event.key === "ArrowDown"
      ? Math.min(buttons.length - 1, current + 1)
      : Math.max(0, current < 0 ? buttons.length - 1 : current - 1);
    buttons[next]?.focus();
    if (buttons[next]?.dataset.groupId) onKeyboardSelect?.(buttons[next].dataset.groupId);
    event.preventDefault();
  };

  return <div ref={listRef} className={styles.activityList} data-density={density} role="listbox"
    aria-label="Try activity" onKeyDown={onKeyDown}>
    {cleared && <p className={styles.clearedNote}>Completed activity cleared. Pending work and current state stay.</p>}
    {groups.map(group => <ActivityRow key={group.id} group={group} selected={group.id === selectedId}
      density={density} onSelect={() => onSelect(group.id)} />)}
    {listening && <div className={styles.listeningEmpty}>
      <span className={styles.listeningIcon}><DebugIcon name="activity" size={22} /></span>
      <strong>Listening</strong>
      <span>Interact with the video to see what happens.</span>
    </div>}
    {!listening && groups.length === 0 && <div className={styles.emptyCard}>
      {filtered ? <>Nothing matches these filters.<button type="button" onClick={onResetFilters}>Show everything</button></>
        : cleared ? "New activity appears here." : "No activity in this run yet."}
    </div>}
  </div>;
}
