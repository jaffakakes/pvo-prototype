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

  // The activity row names the component; the mobile header only needs its status.
  const mobileTitle = holdComponentName
    ? status.title.replace(` for ${holdComponentName}`, "").replace(`${holdComponentName} request`, "request")
    : status.title;

  if (density === "mobile") {
    const words = <>
      <span className={styles.statusTitle}>{mobileTitle}{link && <DebugIcon name="chevron" size={12} />}</span>
      <span className={styles.statusMeta}>
        <span>{formatVideoTime(status.videoTime, true)}</span>
        {requestText && <span className={styles.requestInline}>{requestText}</span>}
      </span>
    </>;
    return <div className={styles.statusLine} data-density="mobile">
      <span className={styles.statusGlyph} data-state={status.state}><DebugIcon name={glyphs[status.state]} size={15} /></span>
      {link
        ? <button type="button" className={styles.statusWords} onClick={onHoldSelect} aria-label={status.title} title={status.title}>{words}</button>
        : <div className={styles.statusWords}>{words}</div>}
    </div>;
  }

  return <div className={styles.statusLine} data-density={density}>
    <span className={styles.sceneChip}>{status.sceneName}</span>
    <span className={styles.videoTime}>{formatVideoTime(status.videoTime, true)}</span>
    <span className={styles.statusGlyph} data-state={status.state}><DebugIcon name={glyphs[status.state]} size={13} /></span>
    <div className={styles.statusWords}>
      <span className={styles.statusTitle}>{status.title}</span>
      {status.sub && <span className={styles.statusSub}>{status.sub}</span>}
    </div>
    {link}
    {requestText && <span className={styles.requestCount}><span className={styles.spinner} aria-hidden="true" />{requestText}</span>}
  </div>;
}
