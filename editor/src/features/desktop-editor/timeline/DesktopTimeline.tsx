import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import { sceneDuration } from "../../../domain/scenes/duration";
import { dur } from "../../../domain/clips/timing";
import { useAssistant } from "../../../state/assistant/assistantStore";
import { useCapture } from "../../../state/captureStore";
import { clearTimelineSelection } from "../../../state/editing/selectionCommands";
import { fmt } from "../../../ui/formatTime";
import { AudioClipBar } from "../../sound/AudioClipBar";
import { SOUNDS } from "../../sound/catalog";
import { useTimingPointer } from "../../timeline/useTimingPointer";
import styles from "./DesktopTimeline.module.css";
import {
  type DesktopTimelineSelection,
  DesktopVisualLayerLabels,
  DesktopVisualLayerLanes,
} from "./DesktopVisualLayerRows";
import { DEFAULT_ZOOM, snappedTime, timelineSnapPoints } from "./geometry";
import { desktopLayerLayout } from "./layerRows";
import { TimelineTimePicker } from "./TimelineTimePicker";
import { TimelineToolbar } from "./TimelineToolbar";

type Props = {
  onOpenLibrary: (tab: string) => void;
  assistant?: ReactNode;
  snap: boolean;
  onSnapChange: (enabled: boolean) => void;
};

export function DesktopTimeline({
  onOpenLibrary,
  assistant,
  snap,
  onSnapChange,
}: Props) {
  const state = useCapture();
  const assistantActive = useAssistant((value) => value.phase !== "idle");
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const content = useRef<HTMLDivElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const scrubbing = useRef<number | null>(null);
  const timing = useTimingPointer(zoom, {
    enabled: snap,
    playhead: state.t,
  });
  const length = sceneDuration(state);
  const sceneName =
    state.scenes.find((item) => item.id === state.currentSceneId)?.name ??
    "scene";
  const ticks = Array.from({ length: Math.ceil(length) + 9 }, (_, i) => i);
  let clipEnd = 0;
  const clipEnds = state.clips.map((clip) => (clipEnd += dur(clip)));
  const blocked = !!state.tryMode;
  const editingBlocked = blocked || !!state.playheadPick;
  const layerLayout = desktopLayerLayout(state, zoom);

  useEffect(() => {
    const element = scroll.current;
    if (!element || (!state.playing && !state.tryMode?.playing)) return;
    const position = state.t * zoom;
    if (position > element.scrollLeft + element.clientWidth - 24)
      element.scrollLeft = Math.max(0, position - element.clientWidth * 0.65);
    else if (position < element.scrollLeft)
      element.scrollLeft = Math.max(0, position - 24);
  }, [state.t, state.playing, state.tryMode?.playing, zoom]);

  const select = (values: DesktopTimelineSelection) => {
    if (blocked || state.playheadPick) return;
    state.patch({
      sel: -1,
      selComp: null,
      selText: null,
      sheet: null,
      playing: false,
      orb: false,
      ...values,
    });
  };
  const scrub = (event: PointerEvent<HTMLElement>) => {
    const element = content.current;
    if (!element || blocked) return;
    const rect = element.getBoundingClientRect();
    const scale = element.offsetWidth ? rect.width / element.offsetWidth : 1;
    const time = (event.clientX - rect.left) / scale / zoom;
    state.patch({
      t: snappedTime(
        time,
        timelineSnapPoints(state.clips, state.components, state.texts),
        zoom,
        length,
        snap,
      ),
      playing: false,
    });
  };
  const beginScrub = (event: PointerEvent<HTMLElement>) => {
    if (event.button > 0 || blocked) return;
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    scrubbing.current = event.pointerId;
    scrub(event);
  };
  const emptyAudioLane = (
    <button
      className={styles.emptyLane}
      onClick={() => onOpenLibrary("audio")}
      disabled={editingBlocked}
    >
      ♪ Add audio
    </button>
  );

  return (
    <section
      className={styles.panel}
      aria-label="Timeline"
      data-desktop-timeline
      data-time-pick={!!state.playheadPick}
    >
      {state.playheadPick ? (
        <TimelineTimePicker />
      ) : (
        <TimelineToolbar
          zoom={zoom}
          onZoom={setZoom}
          snap={snap}
          onSnap={() => onSnapChange(!snap)}
          assistant={assistant}
        />
      )}
      <div
        className={styles.tracks}
        {...(assistantActive ? { inert: "" } : {})}
      >
        <div className={styles.labels} aria-hidden="true">
          <div className={styles.currentTime}>{fmt(state.t)}</div>
          <DesktopVisualLayerLabels rows={layerLayout.rows} />
          {state.audioClips.map((clip) => (
            <div key={clip.id} className={styles.label} data-kind="audio">
              <span>♪</span> {clip.name}
            </div>
          ))}
          <div className={styles.label} data-kind="audio">
            <span>♪</span> Audio
          </div>
        </div>
        <div ref={scroll} className={styles.scroll}>
          <div
            ref={content}
            className={styles.content}
            tabIndex={-1}
            style={{ width: (length + 8) * zoom }}
            onPointerDownCapture={(event) => {
              if (!state.playheadPick) return;
              event.stopPropagation();
              beginScrub(event);
            }}
            onPointerMove={(event) => {
              if (state.playheadPick && scrubbing.current === event.pointerId)
                scrub(event);
            }}
            onPointerUp={() => {
              scrubbing.current = null;
            }}
            onPointerCancel={() => {
              scrubbing.current = null;
            }}
            onClickCapture={(event) => {
              if (!state.playheadPick) return;
              event.preventDefault();
              event.stopPropagation();
            }}
          >
            <div
              className={styles.ruler}
              aria-label="Seek timeline"
              tabIndex={0}
              onPointerDown={beginScrub}
              onPointerMove={(event) => {
                if (scrubbing.current === event.pointerId) scrub(event);
              }}
              onPointerUp={() => {
                scrubbing.current = null;
              }}
              onPointerCancel={() => {
                scrubbing.current = null;
              }}
            >
              {ticks.map((tick) => (
                <span
                  key={tick}
                  className={styles.tick}
                  data-major={tick % 5 === 0}
                  style={{ left: tick * zoom }}
                >
                  {tick % 5 === 0 ? fmt(tick) : ""}
                </span>
              ))}
            </div>
            <DesktopVisualLayerLanes
              layout={layerLayout}
              state={state}
              zoom={zoom}
              clipEnds={clipEnds}
              editingBlocked={editingBlocked}
              sceneName={sceneName}
              timing={timing}
              onOpenLibrary={onOpenLibrary}
              onSelect={select}
            />
            {state.audioClips.map((clip) => (
              <div key={clip.id} className={styles.lane} data-kind="audio">
                <AudioClipBar
                  clip={clip}
                  pixelsPerSecond={zoom}
                  snap={{ enabled: snap, playhead: state.t }}
                />
              </div>
            ))}
            <div
              className={styles.lane}
              data-kind="audio"
              onClick={(event) => {
                if (event.target === event.currentTarget)
                  clearTimelineSelection();
              }}
            >
              {state.sound ? (
                <button
                  className={styles.audio}
                  style={{ width: Math.max(40, length * zoom) }}
                  data-selected={state.sheet === "sound"}
                  disabled={editingBlocked}
                  onClick={() => select({ sheet: "sound" })}
                >
                  ♪ {SOUNDS[state.sound]?.name ?? "Music"}
                </button>
              ) : (
                emptyAudioLane
              )}
            </div>
            <div
              data-desktop-playhead
              data-time={state.t}
              className={styles.playhead}
              style={{ left: state.t * zoom }}
            >
              <span />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
