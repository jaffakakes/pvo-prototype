import type { CSSProperties } from "react";
import { locate, total } from "../../../domain/clips/timing";
import { componentTypeName } from "../../../domain/components/presentation";
import { componentEnd } from "../../../domain/components/timing";
import { sceneDuration } from "../../../domain/scenes/duration";
import { useCapture } from "../../../state/captureStore";
import { scrubPlayback } from "../../../state/editing/playbackCommands";
import { ClipPoster } from "../../../ui/media/ClipPoster";
import { fmt, pickTime } from "../../../ui/formatTime";
import styles from "./AssistantMiniTimeline.module.css";

/** A scene overview: seeking uses the editor command and never edits clips or layers. */
export function AssistantMiniTimeline({
  folded = false,
}: {
  folded?: boolean;
}) {
  const clips = useCapture((state) => state.clips);
  const components = useCapture((state) => state.components);
  const texts = useCapture((state) => state.texts);
  const time = useCapture((state) => state.t);
  const duration = useCapture(sceneDuration);
  const percent = (at: number) =>
    Math.min(100, Math.max(0, (at / (duration || 1)) * 100));
  const step =
    duration <= 6 ? 1 : duration <= 20 ? 5 : Math.ceil(duration / 6 / 5) * 5;
  const labels = [0];
  for (let at = step; at < duration - step * 0.45; at += step) labels.push(at);
  if (duration > 0) labels.push(duration);
  const layers = [
    ...components.map((item) => ({
      id: item.id,
      label: componentTypeName(item),
      start: item.at,
      end: componentEnd(item, clips),
      component: true,
    })),
    ...texts.map((item) => ({
      id: `text-${item.id}`,
      label: item.text || "Text",
      start: item.start,
      end: item.end,
      component: false,
    })),
  ];
  const frames = Array.from({ length: 12 }, (_, index) => {
    const at = (duration * (index + 0.5)) / 12;
    return at < total(clips) ? locate(at, clips) : null;
  });

  return (
    <div
      className={styles.band}
      data-assistant-mini-timeline
      data-folded={folded}
    >
      <div className={styles.track}>
        <div className={styles.ruler} aria-hidden="true">
          {labels.map((at, index) => (
            <span key={index} style={{ left: `${percent(at)}%` }}>
              {fmt(at)}
            </span>
          ))}
        </div>
        <div className={styles.filmstrip} aria-hidden="true">
          {frames.map((frame, index) => (
            <span key={index} className={styles.frame}>
              {frame && (
                <ClipPoster
                  clip={{
                    url: frame.c.url,
                    in: frame.lt,
                    color: frame.c.color,
                  }}
                />
              )}
            </span>
          ))}
        </div>
        <div className={styles.lanes} aria-hidden="true">
          {layers.slice(0, 3).map((layer, index) => (
            <div key={layer.id} className={styles.lane}>
              <span
                data-component={layer.component}
                style={{
                  left: `${percent(layer.start)}%`,
                  width: `${Math.max(0, percent(layer.end) - percent(layer.start))}%`,
                }}
              >
                {index === 2 && layers.length > 3
                  ? `+${layers.length - 2} layers`
                  : layer.label}
              </span>
            </div>
          ))}
        </div>
        <div
          className={styles.playhead}
          style={
            {
              left: `${percent(time)}%`,
              "--pill-shift": `${-percent(time)}%`,
            } as CSSProperties
          }
          aria-hidden="true"
        >
          <span>{pickTime(time)}</span>
        </div>
        <input
          className={styles.seek}
          type="range"
          min={0}
          max={duration}
          step={0.1}
          value={Math.min(time, duration)}
          disabled={duration <= 0}
          aria-label="Playhead — drag to a moment"
          aria-valuetext={pickTime(time)}
          onPointerDown={(event) => {
            if (!folded) return;
            // Scrubbing while typing must keep the textarea and OS keyboard focused.
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            const rect = event.currentTarget.getBoundingClientRect();
            scrubPlayback(
              ((event.clientX - rect.left) / rect.width) * duration,
            );
          }}
          onPointerMove={(event) => {
            if (
              !folded ||
              !event.currentTarget.hasPointerCapture(event.pointerId)
            )
              return;
            const rect = event.currentTarget.getBoundingClientRect();
            scrubPlayback(
              ((event.clientX - rect.left) / rect.width) * duration,
            );
          }}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onChange={(event) => scrubPlayback(Number(event.currentTarget.value))}
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
              return;
            event.preventDefault();
            event.stopPropagation();
            const current = useCapture.getState().t;
            const step = event.shiftKey ? 1 : 0.1;
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? duration
                  : current + (event.key === "ArrowLeft" ? -step : step);
            scrubPlayback(next);
          }}
        />
      </div>
    </div>
  );
}
