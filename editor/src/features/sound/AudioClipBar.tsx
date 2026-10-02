import type { CSSProperties } from "react";
import { audioDuration } from "../../domain/audio/editing";
import type { AudioClip } from "../../domain/audio/model";
import { useCapture } from "../../state/captureStore";
import { useTimingPointer } from "../timeline/useTimingPointer";
import type { TimingSnapSettings } from "../timeline/timingSnap";
import styles from "./AudioClipBar.module.css";
import { TimelineKeyframes } from "../animation/TimelineKeyframes";

export function AudioClipBar({
  clip,
  pixelsPerSecond,
  snap,
  style,
}: {
  clip: AudioClip;
  pixelsPerSecond: number;
  snap?: TimingSnapSettings;
  style?: CSSProperties;
}) {
  const selected = useCapture((state) => state.selAudio === clip.id);
  const blocked = useCapture(
    (state) => !!state.tryMode || !!state.playheadPick,
  );
  const timing = useTimingPointer(pixelsPerSecond, snap);
  const select = () =>
    useCapture
      .getState()
      .patch({
        selAudio: clip.id,
        sel: -1,
        selComp: null,
        selText: null,
        sheet: null,
        playing: false,
        orb: false,
      });
  return (
    <button
      className={styles.clip}
      data-audio-id={clip.id}
      data-selected={selected}
      aria-label={`${clip.name}, ${audioDuration(clip).toFixed(1)} seconds`}
      disabled={blocked}
      style={{
        left: clip.start * pixelsPerSecond,
        width: audioDuration(clip) * pixelsPerSecond,
        ...style,
      }}
      onPointerDown={(event) => {
        if (event.button > 0 || blocked) return;
        select();
        const edge = (event.target as HTMLElement).closest<HTMLElement>(
          "[data-edge]",
        )?.dataset.edge;
        const mode = edge === "l" || edge === "r" ? edge : "move";
        timing.begin(
          event,
          {
            kind: "audio",
            id: clip.id,
            mode,
          },
          mode === "l"
            ? clip.start
            : mode === "r"
              ? clip.start + audioDuration(clip)
              : undefined,
        );
      }}
      onPointerMove={timing.move}
      onPointerUp={timing.end}
      onPointerCancel={timing.end}
      onLostPointerCapture={timing.end}
      onClick={(event) => {
        event.stopPropagation();
        if (!blocked) select();
      }}
    >
      {selected && <span className={styles.handle} data-edge="l" />}
      <span className={styles.name}>
        ♪ {clip.name}
        {clip.muted ? " · muted" : ""}
      </span>
      {selected && <span className={styles.handle} data-edge="r" />}
      <TimelineKeyframes animation={clip.animation} color="#5CF0C0" start={clip.in} end={clip.out} />
    </button>
  );
}
