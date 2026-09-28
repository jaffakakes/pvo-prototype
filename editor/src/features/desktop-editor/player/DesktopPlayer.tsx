import { sceneDuration } from "../../../domain/audio/editing";
import { useCapture } from "../../../state/captureStore";
import { Icon } from "../../../ui/Icon";
import { pickTime } from "../../../ui/formatTime";
import { Preview } from "../../preview/Preview";
import { togglePlayback } from "../../preview/playbackCommands";
import { startTry, stopTry } from "../../preview/tryMode";
import { DesktopSceneBar } from "./DesktopSceneBar";
import styles from "./DesktopPlayer.module.css";

type Props = {
  safeZone: boolean;
  onSafeZoneChange(enabled: boolean): void;
  onOpenProject(): void;
  onOpenLibrary(tab: string): void;
};

export function DesktopPlayer({ safeZone, onSafeZoneChange, onOpenProject, onOpenLibrary }: Props) {
  const time = useCapture(state => state.t);
  const clips = useCapture(state => state.clips);
  const ratio = useCapture(state => state.ratio);
  const playing = useCapture(state => state.playing);
  const tryMode = useCapture(state => state.tryMode);
  const picking = useCapture(state => !!state.playheadPick);
  const duration = useCapture(sceneDuration);

  return <section className={styles.panel} aria-label="Player" data-desktop-player>
    <DesktopSceneBar onOpenTree={() => onOpenLibrary("scenes")} />
    <Preview desktop safeZone={safeZone} onAddMedia={() => onOpenLibrary("media")} />
    <div className={styles.transport}>
      <div className={styles.time} aria-label={`Playback time ${pickTime(time)} of ${pickTime(duration)}`}>
        {pickTime(time)} <span>/ {pickTime(duration)}</span>
      </div>
      <button type="button" className={styles.play} aria-label={playing ? "Pause" : "Play"}
        disabled={!duration || !!tryMode?.holdingId || picking} onClick={togglePlayback}>
        <Icon name={playing ? "pause" : "play"} size={20} />
      </button>
      <div className={styles.actions}>
        <button type="button" className={styles.try} data-on={!!tryMode} disabled={!duration || picking}
          onClick={tryMode ? stopTry : startTry} aria-label={tryMode ? "Stop trying" : "Try"}>
          <span aria-hidden="true">{tryMode ? "■" : "▷"}</span>{tryMode ? "Stop" : "Try"}
        </button>
        <button type="button" className={styles.safe} data-on={safeZone} aria-label="Safe zone" aria-pressed={safeZone}
          onClick={() => onSafeZoneChange(!safeZone)}><Icon name="ratio" size={16} /></button>
        <button type="button" className={styles.ratio} onClick={onOpenProject} disabled={!!tryMode}
          aria-label={`Aspect ratio ${ratio}`}>{ratio}</button>
      </div>
    </div>
  </section>;
}
