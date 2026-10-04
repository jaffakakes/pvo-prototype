import { AudioClipBar } from "../sound/AudioClipBar";
import { TimelineKeyframes } from "../animation/TimelineKeyframes";
import { textStyle } from "../../../../packages/pvo-text-runtime/index.js";
import { dur } from "../../domain/clips/timing";
import { componentLength } from "../../domain/components/timing";
import { setCodePreviewFocus } from "../../state/components/componentAuthoringStore";
import { cx } from "../../styles";
import { fmt } from "../../ui/formatTime";
import { Icon } from "../../ui/Icon";
import { componentLabel } from "../preview/ComponentOverlay";
import { DebugLayerIssue } from "../editor-layout/debugging/DebugLayerIssue";
import { SOUNDS } from "../sound/catalog";
import { EmptySceneTimeline } from "./EmptySceneTimeline";
import { MobilePlayhead } from "./MobilePlayhead";
import { LEAD, PLAYHEAD_X, PPS, stripLeft } from "./geometry";
import styles from "./Timeline.module.css";

import { useTimelineGestures } from "./useTimelineGestures";

export function Timeline() {
  const {
    s,
    playhead,
    timelineRef,
    layerDrag,
    pointer,
    ignoreClick,
    length,
    trimShift,
    ticks,
    layers,
    rows,
    rowEnd,
    timelineHeight,
    selectedLayer,
    rowTop,
    selectLayer,
    layerKeyDown,
    scrubDown,
    scrubMove,
    scrubUp,
    trimDown,
    trimMove,
    trimUp,
    compDown,
    compMove,
    compUp,
    textBarDown,
    textBarMove,
    textBarUp,
  } = useTimelineGestures();
  if (length <= 0) return <EmptySceneTimeline />;

  return (
    <div
      ref={timelineRef}
      className={`${cx("tl")} ${styles.timeline}`}
      data-trying={!!s.tryMode}
      data-time-pick={!!s.playheadPick}
      data-reordering={!!layerDrag.active}
      style={{ height: timelineHeight }}
      onKeyDown={layerKeyDown}
      onPointerDownCapture={() => setCodePreviewFocus(false)}
      onFocusCapture={() => setCodePreviewFocus(false)}
      onPointerDown={scrubDown}
      onPointerMove={scrubMove}
      onPointerUp={scrubUp}
      onPointerCancel={scrubUp}
    >
      <div className={cx("timelineContent")} style={{ height: timelineHeight }}>
        <div
          className={cx("strip")}
          style={{
            left: 0,
            transform: `translateX(${stripLeft(s.t, trimShift, playhead.x)}px)`,
            width: LEAD + length * PPS + 240,
            height: timelineHeight,
          }}
        >
          {ticks.map((k) => (
            <span
              key={k}
              className={cx("tick")}
              style={{ left: LEAD + k * PPS }}
            >
              {k % 2 ? "·" : fmt(k)}
            </span>
          ))}
          <div
            className={cx("tlClips")}
            data-layer-id="video"
            data-dragging={layerDrag.active?.id === "video"}
            style={{ left: LEAD, top: rowTop("video") }}
          >
            {s.clips.map((clip, i) => (
              <button
                key={clip.id}
                className={cx("tlClip")}
                data-index={i}
                data-sel={s.sel === i}
                style={{
                  width: dur(clip) * PPS,
                  background: `linear-gradient(160deg,${clip.color},#15151C)`,
                }}
                onClick={() => {
                  if (!ignoreClick.current && !s.tryMode)
                    s.patch({
                      sel: i,
                      selComp: null,
                      selText: null,
                      orb: false,
                    });
                }}
              >
                {clip.url && (
                  <video
                    src={`${clip.url}#t=${(Math.round(clip.in * 2) / 2).toFixed(1)}`}
                    muted
                    playsInline
                    style={{
                      objectFit: clip.fit,
                      transform: clip.mirror ? "scaleX(-1)" : undefined,
                    }}
                  />
                )}
                {dur(clip) * PPS > 46 && (
                  <span
                    className={cx("clipLen")}
                    style={{ left: s.sel === i ? 18 : 6 }}
                  >
                    {dur(clip).toFixed(1)}s
                  </span>
                )}
                {s.sel === i && (
                  <>
                    <span
                      className={cx("handle handleL")}
                      onPointerDown={(e) => trimDown(e, i, "l")}
                      onPointerMove={trimMove}
                      onPointerUp={trimUp}
                    />
                    <span
                      className={cx("handle handleR")}
                      onPointerDown={(e) => trimDown(e, i, "r")}
                      onPointerMove={trimMove}
                      onPointerUp={trimUp}
                    />
                  </>
                )}
                <TimelineKeyframes color="#FF9FBC" animation={clip.animation} start={clip.in} end={clip.out} />
              </button>
            ))}
            <button
              className={cx("addClip")}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => s.startRecordingIntoScene(s.currentSceneId)}
              aria-label="Add clip"
              disabled={!!s.tryMode}
            >
              <Icon name="plus" size={16} />
            </button>
          </div>
          {s.sound > 0 && (
            <div
              className={cx("audioTrack")}
              style={{
                top: rowEnd + s.audioClips.length * 34,
                left: LEAD,
                width: Math.max(40, length * PPS),
              }}
            >
              <span>♪ {SOUNDS[s.sound]?.name ?? "Music"}</span>
              <TimelineKeyframes color="#5CF0C0" animation={s.scenes.find(scene => scene.id === s.currentSceneId)?.musicAnimation} start={0} end={length} />
            </div>
          )}
          {s.audioClips.map((clip, index) => (
            <AudioClipBar
              key={clip.id}
              clip={clip}
              pixelsPerSecond={PPS}
              snap={{ enabled: true, playhead: s.t }}
              style={{
                top: rowEnd + index * 34,
                left: LEAD + clip.start * PPS,
              }}
            />
          ))}
          {s.texts.map((x) => (
            <button
              key={x.id}
              className={cx("textBar")}
              data-layer-id={`text:${x.id}`}
              data-dragging={layerDrag.active?.id === `text:${x.id}`}
              data-sel={s.selText === x.id}
              style={{
                top: rowTop(`text:${x.id}`),
                left: LEAD + x.start * PPS,
                width: (x.end - x.start) * PPS,
                background:
                  textStyle(x).background === "transparent"
                    ? "#FFD23E"
                    : textStyle(x).background,
                color:
                  textStyle(x).background === "transparent"
                    ? "#111"
                    : textStyle(x).fill,
              }}
              onPointerDown={(e) => textBarDown(e, x)}
              onPointerMove={textBarMove}
              onPointerUp={textBarUp}
              onPointerCancel={textBarUp}
              onClick={(e) => {
                if (e.detail === 0 && !s.tryMode)
                  s.patch({ selText: x.id, sheet: "text" });
              }}
              disabled={!!s.tryMode}
              aria-label={`Text: ${x.text}`}
            >
              {s.selText === x.id && (
                <span className={cx("compHandle")} data-side="l" />
              )}
              <span>{x.text}</span>
              <TimelineKeyframes animation={x.animation} start={0} end={x.end - x.start} />
              {s.selText === x.id && (
                <span className={cx("compHandle")} data-side="r" />
              )}
            </button>
          ))}
          {s.components.map((component) => (
            <button
              key={component.id}
              className={cx(
                `compBar${s.selComp === component.id ? " compSelected" : ""}`,
              )}
              data-sel={s.selComp === component.id}
              data-layer-id={`component:${component.id}`}
              data-dragging={
                layerDrag.active?.id === `component:${component.id}`
              }
              data-layer={layers.indexOf(`component:${component.id}`)}
              style={{
                top: rowTop(`component:${component.id}`),
                left: LEAD + component.at * PPS,
                width: componentLength(component, s.clips) * PPS,
              }}
              onPointerDown={(event) => compDown(event, component)}
              onPointerMove={compMove}
              onPointerUp={compUp}
              onPointerCancel={compUp}
              onClick={(event) => {
                if (event.detail === 0 && !s.tryMode)
                  s.patch({ selComp: component.id, sel: -1 });
              }}
              disabled={!!s.tryMode}
              aria-label={`${component.type}: ${componentLabel(component)}`}
            >
              <TimelineKeyframes color="#A78BFA" animation={component.animation} start={0} end={componentLength(component, s.clips)} />
              {s.selComp === component.id && (
                <span className={cx("compHandle")} data-side="l" />
              )}
              <span className={cx("compContent")}>
                <Icon name={component.type} size={11} />
                <span>{componentLabel(component)}</span>
                <DebugLayerIssue componentId={component.id} />
              </span>
              {s.selComp === component.id && (
                <span className={cx("compHandle")} data-side="r" />
              )}
            </button>
          ))}
        </div>
        <div
          className={styles.labelRail}
          style={{ width: PLAYHEAD_X }}
          aria-hidden="true"
        />
        <span className={styles.currentTime}>
          {fmt(s.t)}.{Math.floor(s.t * 10) % 10}
        </span>
        {layers.map((id) => (
          <button
            key={id}
            className={`${cx("layerName")} ${styles.trackLabel}`}
            data-kind={
              id === "video"
                ? "video"
                : id.startsWith("text:")
                  ? "text"
                  : "components"
            }
            data-reorder-layer={id}
            title="Drag up or down to reorder · Alt + ↑ / ↓"
            aria-label={
              id === "video"
                ? "Select video layer"
                : id.startsWith("text:")
                  ? `Select text layer: ${s.texts.find((t) => `text:${t.id}` === id)?.text}`
                  : `Select component layer: ${s.components.find((c) => `component:${c.id}` === id)?.type}`
            }
            data-sel={selectedLayer === id}
            style={{ top: rows.get(id), height: id === "video" ? 56 : 26 }}
            disabled={!!s.tryMode}
            onPointerDown={(e) => {
              e.stopPropagation();
              if (e.button > 0) return;
              timelineRef.current?.setPointerCapture(e.pointerId);
              pointer.current = {
                x: e.clientX,
                start: s.t,
                dragged: false,
                clipIndex: -2,
              };
              selectLayer(id);
              layerDrag.begin(id, e, true);
            }}
            onClick={(e) => {
              if (e.detail === 0) selectLayer(id);
            }}
          >
            <Icon
              name={
                id === "video"
                  ? "edit"
                  : id.startsWith("text:")
                    ? "text"
                    : "components"
              }
              size={12}
            />
            <span>
              {id === "video" ? (
                <>
                  Video<small>Main track</small>
                </>
              ) : id.startsWith("text:") ? (
                "Text"
              ) : (
                "Components"
              )}
            </span>
          </button>
        ))}
        {s.audioClips.map((clip, index) => (
          <button
            key={clip.id}
            className={`${styles.trackLabel} ${styles.audioLabel}`}
            data-kind="audio"
            style={{ top: rowEnd + index * 34, height: 28 }}
            aria-label={`Select ${clip.name}`}
            disabled={!!s.tryMode}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() =>
              s.patch({
                selAudio: clip.id,
                sel: -1,
                selComp: null,
                selText: null,
                playing: false,
              })
            }
          >
            <Icon name="music" size={12} />
            <span>Audio {index + 1}</span>
          </button>
        ))}
        {s.sound > 0 && (
          <button
            className={`${styles.trackLabel} ${styles.audioLabel}`}
            data-kind="audio"
            style={{ top: rowEnd + s.audioClips.length * 34, height: 30 }}
            aria-label="Music"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => s.patch({ sheet: "sound" })}
          >
            <Icon name="music" size={12} />
            <span>Music</span>
          </button>
        )}
        {layerDrag.active && (
          <div
            className={cx("layerDropTarget")}
            style={{
              top: rows.get(layerDrag.active.id),
              height: layerDrag.active.id === "video" ? 56 : 26,
            }}
          />
        )}
        <MobilePlayhead scrub={playhead} time={s.t} duration={length} disabled={!!s.tryMode} />
      </div>
    </div>
  );
}
