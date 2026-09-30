import { AudioClipBar } from "../../sound/AudioClipBar";
import { sceneDuration } from "../../../domain/audio/editing";
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import { dur } from "../../../domain/clips/timing";
import { componentLength } from "../../../domain/components/timing";
import { useCapture } from "../../../state/captureStore";
import { useAssistant } from "../../../state/assistant/assistantStore";
import { clearTimelineSelection } from "../../../state/editing/selectionCommands";
import { Icon } from "../../../ui/Icon";
import { fmt } from "../../../ui/formatTime";
import { componentLabel } from "../../preview/ComponentOverlay";
import { SOUNDS } from "../../sound/catalog";
import { ClipPoster } from "../../../ui/media/ClipPoster";
import { DEFAULT_ZOOM, snappedTime, timelineSnapPoints } from "./geometry";
import styles from "./DesktopTimeline.module.css";
import { TimelineToolbar } from "./TimelineToolbar";
import { TimelineTimePicker } from "./TimelineTimePicker";
import { useTimingPointer } from "../../timeline/useTimingPointer";

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
  const scene = state.scenes.find((item) => item.id === state.currentSceneId);
  const ticks = Array.from({ length: Math.ceil(length) + 9 }, (_, i) => i);
  let clipEnd = 0;
  const clipEnds = state.clips.map((clip) => (clipEnd += dur(clip)));
  const blocked = !!state.tryMode;
  const editingBlocked = blocked || !!state.playheadPick;
  useEffect(() => {
    const element = scroll.current;
    if (!element || (!state.playing && !state.tryMode?.playing)) return;
    const position = state.t * zoom;
    if (position > element.scrollLeft + element.clientWidth - 24)
      element.scrollLeft = Math.max(0, position - element.clientWidth * 0.65);
    else if (position < element.scrollLeft)
      element.scrollLeft = Math.max(0, position - 24);
  }, [state.t, state.playing, state.tryMode?.playing, zoom]);
  const select = (values: {
    sel?: number;
    selComp?: string;
    selText?: number;
    sheet?: "component" | "text" | "sound";
  }) => {
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
  const emptyLane = (tab: string, label: string) => (
    <button
      className={styles.emptyLane}
      onClick={() => onOpenLibrary(tab)}
      disabled={editingBlocked}
    >
      {label}
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
          <div className={styles.label} data-kind="components">
            <span>✦</span> Components
          </div>
          <div className={styles.label} data-kind="text">
            <span>T</span> Text
          </div>
          <div className={`${styles.label} ${styles.videoLabel}`}>
            <Icon name="pvoExport" size={16} />
            <div>
              Video<small>Main track</small>
            </div>
          </div>
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
            <div
              className={styles.lane}
              data-kind="components"
              onClick={(event) => {
                if (event.target === event.currentTarget)
                  clearTimelineSelection();
              }}
            >
              {!state.components.length &&
                emptyLane("components", "✦ Add an interactive component")}
              {state.components.map((component) => (
                <button
                  key={component.id}
                  className={styles.block}
                  data-kind="component"
                  data-selected={state.selComp === component.id}
                  style={{
                    left: component.at * zoom,
                    width: componentLength(component, state.clips) * zoom,
                  }}
                  aria-label={`${component.type}: ${componentLabel(component)}`}
                  disabled={editingBlocked}
                  onPointerDown={(event) => {
                    select({ selComp: component.id, sheet: "component" });
                    const edge = (
                      event.target as HTMLElement
                    ).closest<HTMLElement>("[data-edge]")?.dataset.edge;
                    const mode =
                      edge === "l" ? "start" : edge === "r" ? "end" : "move";
                    timing.begin(
                      event,
                      {
                        kind: "component",
                        id: component.id,
                        mode,
                      },
                      mode === "start"
                        ? component.at
                        : mode === "end"
                          ? component.at +
                            componentLength(component, state.clips)
                          : undefined,
                    );
                  }}
                  onPointerMove={timing.move}
                  onPointerUp={timing.end}
                  onPointerCancel={timing.end}
                  onLostPointerCapture={timing.end}
                  onClick={() =>
                    select({ selComp: component.id, sheet: "component" })
                  }
                >
                  {state.selComp === component.id && (
                    <span className={styles.blockHandle} data-edge="l" />
                  )}
                  <span>✦ {componentLabel(component)}</span>
                  {state.selComp === component.id && (
                    <span className={styles.blockHandle} data-edge="r" />
                  )}
                </button>
              ))}
            </div>
            <div
              className={styles.lane}
              data-kind="text"
              onClick={(event) => {
                if (event.target === event.currentTarget)
                  clearTimelineSelection();
              }}
            >
              {!state.texts.length && emptyLane("text", "T Add text")}
              {state.texts.map((text) => (
                <button
                  key={text.id}
                  className={styles.block}
                  data-kind="text"
                  data-selected={state.selText === text.id}
                  style={{
                    left: text.start * zoom,
                    width: (text.end - text.start) * zoom,
                  }}
                  aria-label={`Text: ${text.text}`}
                  disabled={editingBlocked}
                  onPointerDown={(event) => {
                    select({ selText: text.id, sheet: "text" });
                    const edge = (
                      event.target as HTMLElement
                    ).closest<HTMLElement>("[data-edge]")?.dataset.edge;
                    const mode = edge === "l" || edge === "r" ? edge : "move";
                    timing.begin(
                      event,
                      {
                        kind: "text",
                        id: text.id,
                        mode,
                      },
                      mode === "l"
                        ? text.start
                        : mode === "r"
                          ? text.end
                          : undefined,
                    );
                  }}
                  onPointerMove={timing.move}
                  onPointerUp={timing.end}
                  onPointerCancel={timing.end}
                  onLostPointerCapture={timing.end}
                  onClick={() => select({ selText: text.id, sheet: "text" })}
                >
                  {state.selText === text.id && (
                    <span className={styles.blockHandle} data-edge="l" />
                  )}
                  <span>T {text.text}</span>
                  {state.selText === text.id && (
                    <span className={styles.blockHandle} data-edge="r" />
                  )}
                </button>
              ))}
            </div>
            <div
              className={styles.videoLane}
              onClick={(event) => {
                if (event.target === event.currentTarget)
                  clearTimelineSelection();
              }}
            >
              {!state.clips.length ? (
                <button
                  className={styles.addScene}
                  onClick={() => onOpenLibrary("media")}
                >
                  ＋ Add clips to {scene?.name ?? "scene"}
                </button>
              ) : (
                <>
                  <div className={styles.clips}>
                    {state.clips.map((clip, index) => (
                      <button
                        key={clip.id}
                        className={styles.clip}
                        data-selected={state.sel === index}
                        style={{ width: dur(clip) * zoom }}
                        aria-label={`Clip ${index + 1}, ${dur(clip).toFixed(1)} seconds`}
                        onClick={() => select({ sel: index })}
                        disabled={editingBlocked}
                      >
                        <ClipPoster clip={clip} />
                        <span className={styles.clipShade} />
                        <span className={styles.clipDuration}>
                          {dur(clip).toFixed(1)}s
                        </span>
                        <span className={styles.clipName}>
                          Clip {index + 1}
                        </span>
                        {state.sel === index &&
                          (["l", "r"] as const).map((side) => (
                            <span
                              key={side}
                              className={styles.clipHandle}
                              data-edge={side}
                              onPointerDown={(event) =>
                                timing.begin(
                                  event,
                                  {
                                    kind: "clip",
                                    id: clip.id,
                                    mode: side,
                                  },
                                  side === "r" ? clipEnds[index] : undefined,
                                )
                              }
                              onPointerMove={timing.move}
                              onPointerUp={timing.end}
                              onPointerCancel={timing.end}
                              onLostPointerCapture={timing.end}
                            />
                          ))}
                      </button>
                    ))}
                  </div>
                  <button
                    className={styles.addClip}
                    aria-label="Add clips"
                    disabled={editingBlocked}
                    onClick={() => onOpenLibrary("media")}
                  >
                    <Icon name="plus" size={18} />
                  </button>
                </>
              )}
            </div>
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
                emptyLane("audio", "♪ Add audio")
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
