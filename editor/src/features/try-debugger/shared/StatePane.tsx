import type { DebugRun, DebugStateRow } from "../../../domain/debugging/types";
import { DebugIcon } from "./DebugIcon";
import { formatVideoTime } from "./format";
import styles from "../TryDebugger.module.css";

type StatePaneProps = {
  run: DebugRun | null;
  rows: DebugStateRow[];
  pinnedPaths: string[];
  density: "desktop" | "mobile";
  onTogglePin: (path: string) => void;
};

function PlaybackCard({ run }: { run: DebugRun | null }) {
  const playback = run?.playback;
  const holding = run?.components.find(component => component.id === playback?.holdingId);
  const facts: Array<[string, string]> = playback ? [
    ["Scene", playback.sceneName],
    ["Video time", formatVideoTime(playback.videoTime, true)],
    ["Requested", playback.requested],
    ["Video", playback.observed],
    ["Holding playback", holding ? `${holding.name}${playback.holdReason ? ` · ${playback.holdReason}` : ""}` : "None observed"],
  ] : [];
  return <section className={styles.playbackCard}>
    <h3>Playback</h3>
    <p>What was asked for and what the video actually did are recorded separately.</p>
    <dl className={styles.factList}>{facts.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
  </section>;
}

export function StatePane({ run, rows, pinnedPaths, density, onTogglePin }: StatePaneProps) {
  const pinned = pinnedPaths.map(path => rows.find(row => row.path === path)).filter((row): row is DebugStateRow => Boolean(row));
  return <div className={styles.statePane} data-density={density}>
    <div className={styles.stateRows}>
      {density === "mobile" && <h3 className={styles.eyebrow}>Current state · read-only</h3>}
      {rows.length === 0 && <div className={styles.emptyCard}>No state values recorded in this run yet.</div>}
      {rows.map(row => <div key={row.path} className={styles.stateRow} data-pinned={pinnedPaths.includes(row.path)}>
        <button type="button" className={styles.pinButton} onClick={() => onTogglePin(row.path)}
          aria-label={`${pinnedPaths.includes(row.path) ? "Unpin" : "Pin"} ${row.path}`} aria-pressed={pinnedPaths.includes(row.path)}>
          <DebugIcon name="pin" size={15} />
        </button>
        <code>{row.path}</code>
        <span><code data-masked={row.masked}>{row.displayValue}</code>
          {row.masked && <small>Masked · never copied</small>}
          {!row.masked && row.changedAt != null && <small>Changed at {formatVideoTime(row.changedAt)}</small>}
        </span>
      </div>)}
    </div>
    {(density === "desktop" || pinned.length > 0) && <div className={styles.stateAside}>
      <h3 className={styles.eyebrow}>Watching</h3>
      <p className={styles.asideNote}>Current state, not a snapshot of the selected event.</p>
      <div className={styles.watchingGrid}>
        {pinned.length === 0 && <div className={styles.emptyCard}>Pin a value to watch it here.</div>}
        {pinned.map(row => <div key={row.path} className={styles.watchingCard}>
          <code>{row.path}</code><strong>{row.displayValue}</strong>
          <small>{row.masked ? "Masked · never copied" : row.changedAt != null ? `Changed at ${formatVideoTime(row.changedAt)}` : "Current value"}</small>
        </div>)}
      </div>
      {density === "desktop" && <PlaybackCard run={run} />}
      {density === "desktop" && <p className={styles.retentionNote}>Values belong to this run · kept after Stop · replaced by the next run.</p>}
    </div>}
    {density === "mobile" && <div className={styles.mobilePlayback}>
      <details className={styles.detailDisclosure}>
        <summary>Playback details</summary>
        <PlaybackCard run={run} />
      </details>
      <p className={styles.retentionNote}>Values belong to this run · kept after Stop · replaced by the next run.</p>
    </div>}
  </div>;
}
