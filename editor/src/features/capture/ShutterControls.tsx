import { dur, total } from "../../domain/clips/timing";
import { useCapture } from "../../state/captureStore";
import { cx } from "../../styles";
import { Icon } from "../../ui/Icon";
import {
  RING_CIRCUMFERENCE,
  ringArcs,
  ringScale,
  type RingItem,
} from "./recordingRing";
import type { useRecorder } from "./useRecorder";

type Props = Pick<
  ReturnType<typeof useRecorder>,
  "onShutterDown" | "onShutterUp"
> & {
  cameraPending: boolean;
  cameraStatus: string;
  microphoneAvailable: boolean;
  hint: string;
  removeLast(): void;
  onUpload(): void;
};
export function ShutterControls({
  cameraPending,
  cameraStatus,
  microphoneAvailable,
  hint,
  removeLast,
  onUpload,
  onShutterDown,
  onShutterUp,
}: Props) {
  const s = useCapture();
  const count = s.clips.length;
  const live = s.recording ? s.elapsed : 0;
  const used = total(s.clips.filter((clip) => clip.id !== s.replacing));
  const ringItems: RingItem[] = [];
  for (const clip of s.clips) {
    if (clip.id === s.replacing) {
      if (s.recording && live > 0)
        ringItems.push({ id: "live", seconds: live, color: "#FF9FBC" });
    } else
      ringItems.push({ id: clip.id, seconds: dur(clip), color: clip.color });
  }
  if (s.replacing == null && s.recording && live > 0)
    ringItems.push({ id: "live", seconds: live, color: "#FF9FBC" });
  const scale = ringScale(used + live);
  const arcs = ringArcs(ringItems, scale);
  return (
    <div className={cx("camBottom")}>
      {s.speedRow && !s.recording && (
        <div className={cx("speedRow")}>
          {([0.3, 0.5, 1, 2, 3] as const).map((speed) => (
            <button
              key={speed}
              data-on={s.recSpeed === speed}
              onClick={() => s.patch({ recSpeed: speed, speedRow: false })}
            >
              {speed}x
            </button>
          ))}
        </div>
      )}
      <div className={cx("shutterRow")}>
        <button
          className={cx("sideAction")}
          onClick={() =>
            count && s.replacing == null ? removeLast() : onUpload()
          }
          aria-label={
            count && s.replacing == null ? "Undo last take" : "Upload video"
          }
        >
          <span className={cx("side50 press")}>
            <Icon
              name={count && s.replacing == null ? "undoTake" : "upload"}
              size={22}
            />
          </span>
          <span className={cx("sideLabel")}>
            {count && s.replacing == null ? "Undo" : "Upload"}
          </span>
        </button>
        <button
          className={cx("shutter")}
          data-rec={s.recording}
          data-clips={count}
          data-scale={scale}
          disabled={cameraPending || s.importing}
          onPointerDown={onShutterDown}
          onPointerUp={onShutterUp}
          onPointerCancel={onShutterUp}
          aria-label={s.recording ? "Stop recording" : "Record"}
        >
          <span className={cx("ring")} />
          {arcs.length > 0 && (
            <svg width="88" height="88" viewBox="0 0 88 88" aria-hidden="true">
              <g transform="rotate(-90 44 44)">
                {arcs.map((arc) => (
                  <circle
                    key={arc.id}
                    data-seconds={arc.seconds}
                    cx="44"
                    cy="44"
                    r="41"
                    fill="none"
                    stroke={arc.color}
                    strokeWidth="5"
                    strokeDasharray={`${arc.length} ${RING_CIRCUMFERENCE - arc.length}`}
                    strokeDashoffset={arc.offset}
                  />
                ))}
              </g>
            </svg>
          )}
          <span className={cx("core")} />
        </button>
        {count > 0 && s.replacing == null && (
          <button
            className={cx("sideAction")}
            onClick={() => onUpload()}
            aria-label="Upload video"
          >
            <span className={cx("side50 press")}>
              <Icon name="upload" size={22} />
            </span>
            <span className={cx("sideLabel")}>Upload</span>
          </button>
        )}
      </div>
      <span className={cx("camHint")} role={s.importing ? "status" : undefined}>
        {s.importing ? "Importing videos…" : hint}
      </span>
      {cameraStatus === "ready" && !microphoneAvailable && (
        <span className={cx("camHint")}>
          Microphone unavailable · video only
        </span>
      )}
    </div>
  );
}
