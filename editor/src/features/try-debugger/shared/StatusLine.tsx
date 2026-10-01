import type { DebugStatus } from "../../../domain/debugging/types";
import { DebugIcon } from "./DebugIcon";
import { formatElapsed, formatVideoTime } from "./format";
import styles from "../TryDebugger.module.css";

type StatusLineProps = {
  status: DebugStatus;
  density: "desktop" | "mobile";
  holdComponentName?: string;
  onHoldSelect?: () => void;
};

const glyphs = {
  playing: "play",
  paused: "pause",
  held: "pause",
  failed: "pause",
  waiting: "pause",
  stopped: "stop",
} as const;

export function StatusLine({ status, density, holdComponentName, onHoldSelect }: StatusLineProps) {
  const running = status.requestsRunning;
  const requestText = running > 0
    ? `${running} request${running === 1 ? "" : "s"} running · ${formatElapsed(status.requestElapsed)}`
    : null;
  const link = status.holdComponentId && holdComponentName && onHoldSelect
    ? <button type="button" className={styles.holdLink} onClick={onHoldSelect} title="Show what this component did">
      <span className={styles.violetDot} aria-hidden="true" />{holdComponentName}<DebugIcon name="chevron" size={12} />
    </button>
    : null;

  return <div className={styles.statusLine} data-density={density}>
    <span className={styles.sceneChip}>{status.sceneName}</span>
    <span className={styles.videoTime}>{formatVideoTime(status.videoTime, true)}</span>
    <span className={styles.statusGlyph} data-state={status.state}><DebugIcon name={glyphs[status.state]} size={13} /></span>
    <div className={styles.statusWords}>
      <span className={styles.statusTitle}>{status.title}</span>
      {status.sub && <span className={styles.statusSub}>{status.sub}</span>}
      {density === "mobile" && <div className={styles.statusMeta}>
        <span>{status.sceneName} · {formatVideoTime(status.videoTime, true)}</span>
        {status.sub && <span>{status.sub}</span>}
        {requestText && <span className={styles.requestInline}>{requestText}</span>}
        {link}
      </div>}
    </div>
    {density === "desktop" && link}
    {density === "desktop" && requestText && <span className={styles.requestCount}><span className={styles.spinner} aria-hidden="true" />{requestText}</span>}
  </div>;
}
