import { LayerReorderHandle } from "./LayerReorderHandle";
import { MusicClipBar } from "../sound/MusicClipBar";
import { sceneLayers } from "../../domain/layers/sceneLayers";
import { selectComponentLayer } from "../../state/components/componentLayerCommands";
import { componentTypeName } from "../../domain/components/presentation";
import { AudioClipBar } from "../sound/AudioClipBar";
import { CoverButton } from "../cover/CoverButton";
import { TimelineKeyframes } from "../animation/TimelineKeyframes";
import { TimelineAnimationPoints } from "../animation/TimelineAnimationPoints";
import { dur } from "../../domain/clips/timing";
import { componentLength } from "../../domain/components/timing";
import { setCodePreviewFocus } from "../../state/components/componentAuthoringStore";
import { cx } from "../../styles";
import { fmt } from "../../ui/formatTime";
import { Icon } from "../../ui/Icon";
import { componentLabel } from "../../domain/components/presentation";
import { DebugLayerIssue } from "../editor-layout/debugging/DebugLayerIssue";
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
    ignoreClick,
    length,
    trimShift,
    ticks,
    layers,
    rows,
    timelineHeight,
    selectedLayer,
    rowTop,
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
  const entries = new Map(sceneLayers(s).map((layer) => [layer.id, layer]));
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
          <div data-timeline-ruler className={styles.timeRuler}>
            {ticks.map((k) => (
              <span
                key={k}
                className={cx("tick")}
                style={{ left: LEAD + k * PPS }}
              >
                {k % 2 ? "·" : fmt(k)}
              </span>
            ))}
          </div>
          <div
            className={cx("tlClips")}
            data-layer-id="video"
            data-dragging={layerDrag.active?.id === "video"}
            style={{ left: LEAD, top: rowTop("video") }}
          >
            {s.clips.map((clip, i) => (
              <div key={clip.id} className={styles.clipSlot}>
                <button
                  className={cx("tlClip")}
                  data-index={i}
                  data-sel={s.sel === i}
                  style={{
                    width: dur(clip) * PPS,
                  }}
                  onClick={() => {
                    if (!ignoreClick.current && !s.tryMode)
                      s.patch({
                        sel: i,
                        selComp: null,
                        selText: null,
                        selAudio: null,
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
                        onPointerCancel={trimUp}
                        onLostPointerCapture={trimUp}
                      />
                      <span
                        className={cx("handle handleR")}
                        onPointerDown={(e) => trimDown(e, i, "r")}
                        onPointerMove={trimMove}
                        onPointerUp={trimUp}
                        onPointerCancel={trimUp}
                        onLostPointerCapture={trimUp}
                      />
                    </>
                  )}
                  {s.sel !== i && (
                    <TimelineKeyframes
                      color="var(--pale)"
                      animation={clip.animation}
                      start={clip.in}
                      end={clip.out}
                    />
                  )}
                </button>
                {s.sel === i && <TimelineAnimationPoints clipId={clip.id} />}
              </div>
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
          {s.music && (
            <MusicClipBar
              music={s.music}
              pixelsPerSecond={PPS}
              snap={{ enabled: true, playhead: s.t }}
              layerDrag={layerDrag}
              style={{ top: rowTop("music"), left: LEAD + s.music.start * PPS }}
            />
          )}
          {s.audioClips.map((clip) => (
            <AudioClipBar
              key={clip.id}
              clip={clip}
              pixelsPerSecond={PPS}
              snap={{ enabled: true, playhead: s.t }}
              layerDrag={layerDrag}
              style={{
                top: rowTop(`audio:${clip.id}`),
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
                background: "var(--yellow)",
                color: "var(--yellow-foreground)",
              }}
              onPointerDown={(e) => textBarDown(e, x)}
              onPointerMove={textBarMove}
              onPointerUp={textBarUp}
              onPointerCancel={textBarUp}
              onLostPointerCapture={textBarUp}
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
              <TimelineKeyframes
                animation={x.animation}
                start={0}
                end={x.end - x.start}
              />
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
              onLostPointerCapture={compUp}
              onClick={(event) => {
                if (event.detail === 0 && !s.tryMode) {
                  setCodePreviewFocus(false);
                  selectComponentLayer(component.id);
                }
              }}
              disabled={!!s.tryMode}
              aria-label={`${component.type}: ${componentLabel(component)}`}
            >
              <TimelineKeyframes
                color="#A78BFA"
                animation={component.animation}
                start={0}
                end={componentLength(component, s.clips)}
              />
              {s.selComp === component.id && (
                <span className={cx("compHandle")} data-side="l" />
              )}
              <span className={cx("compContent")}>
                <Icon name={component.type} size={11} />
                <span>
                  {componentTypeName(component)} ·{" "}
                  {Number(componentLength(component, s.clips).toFixed(1))} s
                </span>
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
        <CoverButton
          style={{
            position: "absolute",
            left: 64,
            top: rowTop("video"),
            zIndex: 4,
          }}
        />
        {layers.map((id) => (
          <LayerReorderHandle
            key={id}
            id={id}
            drag={layerDrag}
            className={`${cx("layerName")} ${styles.trackLabel}`}
            kind={entries.get(id)?.type}
            label={`Select ${entries.get(id)?.type} layer${id === "video" ? "" : `: ${entries.get(id)?.label}`}`}
            selected={selectedLayer === id}
            style={{ top: rows.get(id), height: id === "video" ? 56 : 26 }}
            disabled={!!s.tryMode}
          >
            <Icon
              name={
                id === "video"
                  ? "edit"
                  : entries.get(id)?.type === "text"
                    ? "text"
                    : entries.get(id)?.visual
                      ? "components"
                      : "music"
              }
              size={20}
            />
          </LayerReorderHandle>
        ))}
        {layerDrag.active && (
          <div
            className={cx("layerDropTarget")}
            style={{
              top: rows.get(layerDrag.active.id),
              height: layerDrag.active.id === "video" ? 56 : 26,
            }}
          />
        )}
        <MobilePlayhead
          scrub={playhead}
          time={s.t}
          duration={length}
          disabled={!!s.tryMode}
        />
      </div>
    </div>
  );
}
