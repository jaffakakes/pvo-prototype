import { useState, type CSSProperties, type PointerEvent } from "react";
import type { Scene } from "../../../domain/project/model";
import { PropertyLane, PropertyLaneLabel } from "../../animation/timeline/PropertyLane";
import { TimelineKeyframes } from "../../animation/TimelineKeyframes";
import { componentLength } from "../../../domain/components/timing";
import { dur } from "../../../domain/clips/timing";
import { clearTimelineSelection } from "../../../state/editing/selectionCommands";
import { setCodePreviewFocus } from "../../../state/components/componentAuthoringStore";
import type { CaptureState } from "../../../state/types";
import { ClipPoster } from "../../../ui/media/ClipPoster";
import { Icon } from "../../../ui/Icon";
import { componentLabel } from "../../preview/ComponentOverlay";
import { useTimingPointer } from "../../timeline/useTimingPointer";
import { DebugLayerIssue } from "../../editor-layout/debugging/DebugLayerIssue";
import styles from "./DesktopTimeline.module.css";
import type { DesktopLayerLayout, DesktopLayerRow } from "./layerRows";

export type DesktopTimelineSelection = {
  sel?: number;
  selComp?: string;
  selText?: number;
  sheet?: "component" | "text" | "sound";
};

type VisualLayerState = Pick<
  CaptureState,
  "clips" | "components" | "texts" | "sel" | "selComp" | "selText"
>;

function rowTemplate(rows: DesktopLayerRow[]) {
  return rows.map((row, index) => {
    const height = row.kind === "video" ? 52 : row.kind === "animation" ? row.lane.single ? 20 : 18 : 24;
    const gap = index === 0 ? 0 : row.kind === "animation" ? rows[index - 1].kind === "animation" ? 3 : 4 : row.kind === "video" ? 4 : 6;
    return `${height + gap}px`;
  }).join(" ");
}

function visualGridStyle(rows: DesktopLayerRow[]): CSSProperties {
  return { gridTemplateRows: rowTemplate(rows) };
}

export function DesktopVisualLayerLabels({
  rows, scene,
}: {
  rows: DesktopLayerRow[];
  scene: Scene | undefined;
}) {
  let overlayNumber = 0;
  return (
    <div className={styles.visualLabels} style={visualGridStyle(rows)}>
      {rows.map((row, rowIndex) => {
        const gridStyle = { gridRow: rowIndex + 1 };
        if (row.kind === "animation") return scene
          ? <PropertyLaneLabel key={row.id} scene={scene} lane={row.lane} style={gridStyle} /> : null;
        if (row.kind === "empty-components")
          return (
            <div
              key={row.id}
              className={styles.label}
              data-kind="components"
              data-desktop-layer-label={row.id}
              style={gridStyle}
            >
              <span>✦</span>
              <span className={styles.labelText}>Components</span>
            </div>
          );
        if (row.kind === "empty-text")
          return (
            <div
              key={row.id}
              className={styles.label}
              data-kind="text"
              data-desktop-layer-label={row.id}
              style={gridStyle}
            >
              <span>T</span>
              <span className={styles.labelText}>Text</span>
            </div>
          );
        if (row.kind === "video")
          return (
            <div
              key={row.id}
              className={`${styles.label} ${styles.videoLabel}`}
              data-desktop-layer-label={row.id}
              data-layer-id="video"
              style={gridStyle}
            >
              <Icon name="pvoExport" size={16} />
              <div>
                Video<small>Main track</small>
              </div>
            </div>
          );

        overlayNumber += 1;
        return (
          <div
            key={row.id}
            className={styles.label}
            data-kind="overlay"
            data-overlay-side={row.side}
            data-desktop-layer-label={row.id}
            style={gridStyle}
          >
            <span>▤</span>
            <span className={styles.labelText}>Layer {overlayNumber}</span>
          </div>
        );
      })}
    </div>
  );
}

function VideoLane({
  rowIndex,
  state,
  zoom,
  clipEnds,
  editingBlocked,
  sceneName,
  timing,
  onOpenLibrary,
  onSelect,
}: {
  rowIndex: number;
  state: VisualLayerState;
  zoom: number;
  clipEnds: number[];
  editingBlocked: boolean;
  sceneName: string;
  timing: ReturnType<typeof useTimingPointer>;
  onOpenLibrary(tab: string): void;
  onSelect(values: DesktopTimelineSelection): void;
}) {
  return (
    <div
      className={styles.videoLane}
      data-desktop-layer-lane="video"
      data-layer-id="video"
      style={{ gridRow: rowIndex + 1 }}
      onClick={(event) => {
        if (event.target === event.currentTarget) clearTimelineSelection();
      }}
    >
      {!state.clips.length ? (
        <button
          className={styles.addScene}
          disabled={editingBlocked}
          onClick={() => onOpenLibrary("media")}
        >
          ＋ Add clips to {sceneName}
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
                onClick={() => onSelect({ sel: index })}
                disabled={editingBlocked}
              >
                <ClipPoster clip={clip} />
                <span className={styles.clipShade} />
                <span className={styles.clipDuration}>
                  {dur(clip).toFixed(1)}s
                </span>
                <span className={styles.clipName}>Clip {index + 1}</span>
                <TimelineKeyframes animation={clip.animation} color="#FF9FBC" start={clip.in} end={clip.out} />
                {state.sel === index &&
                  (["l", "r"] as const).map((side) => (
                    <span
                      key={side}
                      className={styles.clipHandle}
                      data-edge={side}
                      onPointerDown={(event) =>
                        timing.begin(
                          event,
                          { kind: "clip", id: clip.id, mode: side },
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
  );
}

export function DesktopVisualLayerLanes({
  layout,
  state,
  zoom,
  clipEnds,
  editingBlocked,
  sceneName,
  timing,
  onOpenLibrary,
  onSelect,
  scene,
  onScrub,
}: {
  scene: Scene | undefined;
  onScrub: (event: PointerEvent<HTMLElement>) => void;
  layout: DesktopLayerLayout;
  state: VisualLayerState;
  zoom: number;
  clipEnds: number[];
  editingBlocked: boolean;
  sceneName: string;
  timing: ReturnType<typeof useTimingPointer>;
  onOpenLibrary(tab: string): void;
  onSelect(values: DesktopTimelineSelection): void;
}) {
  const emptyLane = (tab: string, label: string) => (
    <button
      className={styles.emptyLane}
      onClick={() => onOpenLibrary(tab)}
      disabled={editingBlocked}
    >
      {label}
    </button>
  );

  const videoRowIndex = layout.rows.findIndex((row) => row.kind === "video");
  const componentByLayerId = new Map(
    state.components.map((component) => [
      `component:${component.id}`,
      component,
    ]),
  );
  const textByLayerId = new Map(
    state.texts.map((text) => [`text:${text.id}`, text]),
  );
  const orderedOverlayLayerIds = layout.rows.flatMap((row) =>
    row.kind === "overlay" ? row.layerIds : [],
  );
  const [heldOverlayLayerIds, setHeldOverlayLayerIds] = useState<
    typeof orderedOverlayLayerIds | null
  >(null);
  const renderedOverlayLayerIds =
    heldOverlayLayerIds ?? orderedOverlayLayerIds;
  const endTiming = (event: Parameters<typeof timing.end>[0]) => {
    timing.end(event);
    setHeldOverlayLayerIds(null);
  };

  return (
    <div
      className={styles.visualStack}
      data-desktop-visual-stack
      style={visualGridStyle(layout.rows)}
    >
      {layout.rows.map((row, rowIndex) => {
        if (row.kind === "animation") return scene
          ? <PropertyLane key={row.id} scene={scene} lane={row.lane} zoom={zoom} disabled={editingBlocked}
              onScrub={onScrub} style={{ gridRow: rowIndex + 1 }} /> : null;
        if (row.kind === "empty-components")
          return (
            <div
              key={row.id}
              className={styles.lane}
              data-kind="components"
              data-desktop-layer-lane={row.id}
              style={{ gridRow: rowIndex + 1 }}
            >
              {emptyLane("components", "✦ Add an interactive component")}
            </div>
          );
        if (row.kind === "empty-text")
          return (
            <div
              key={row.id}
              className={styles.lane}
              data-kind="text"
              data-desktop-layer-lane={row.id}
              style={{ gridRow: rowIndex + 1 }}
            >
              {emptyLane("text", "T Add text")}
            </div>
          );
        if (row.kind === "video") return null;
        return (
          <div
            key={row.id}
            className={styles.lane}
            data-kind="overlay"
            data-overlay-side={row.side}
            data-desktop-layer-lane={row.id}
            data-layer-ids={row.layerIds.join(" ")}
            style={{ gridRow: rowIndex + 1 }}
            onClick={(event) => {
              if (event.target === event.currentTarget)
                clearTimelineSelection();
            }}
          />
        );
      })}

      <VideoLane
        rowIndex={videoRowIndex}
        state={state}
        zoom={zoom}
        clipEnds={clipEnds}
        editingBlocked={editingBlocked}
        sceneName={sceneName}
        timing={timing}
        onOpenLibrary={onOpenLibrary}
        onSelect={onSelect}
      />

      {renderedOverlayLayerIds.map((layerId) => {
        const rowIndex = layout.rowIndexByLayer[layerId];
        if (rowIndex == null) return null;
        const component = componentByLayerId.get(layerId);
        if (!component) {
          const text = textByLayerId.get(layerId);
          if (!text) return null;
          return (
            <button
              key={layerId}
              className={styles.block}
              data-kind="text"
              data-layer-id={layerId}
              data-selected={state.selText === text.id}
              style={{
                gridRow: rowIndex + 1,
                left: text.start * zoom,
                width: (text.end - text.start) * zoom,
              }}
              aria-label={`Text: ${text.text}`}
              disabled={editingBlocked}
              onPointerDown={(event) => {
                if (event.button === 0)
                  setHeldOverlayLayerIds(orderedOverlayLayerIds);
                onSelect({ selText: text.id, sheet: "text" });
                const edge = (event.target as HTMLElement).closest<HTMLElement>(
                  "[data-edge]",
                )?.dataset.edge;
                const mode = edge === "l" || edge === "r" ? edge : "move";
                timing.begin(
                  event,
                  { kind: "text", id: text.id, mode },
                  mode === "l"
                    ? text.start
                    : mode === "r"
                      ? text.end
                      : undefined,
                );
              }}
              onPointerMove={timing.move}
              onPointerUp={endTiming}
              onPointerCancel={endTiming}
              onLostPointerCapture={endTiming}
              onClick={() => onSelect({ selText: text.id, sheet: "text" })}
            >
              {state.selText === text.id && (
                <span className={styles.blockHandle} data-edge="l" />
              )}
              <span>T {text.text}</span>
              <TimelineKeyframes animation={text.animation} start={0} end={text.end - text.start} />
              {state.selText === text.id && (
                <span className={styles.blockHandle} data-edge="r" />
              )}
            </button>
          );
        }
        return (
          <button
            key={layerId}
            className={styles.block}
            data-kind="component"
            data-layer-id={layerId}
            data-selected={state.selComp === component.id}
            style={{
              gridRow: rowIndex + 1,
              left: component.at * zoom,
              width: componentLength(component, state.clips) * zoom,
            }}
            aria-label={`${component.type}: ${componentLabel(component)}`}
            disabled={editingBlocked}
            onPointerDown={(event) => {
              if (event.button === 0)
                setHeldOverlayLayerIds(orderedOverlayLayerIds);
              onSelect({ selComp: component.id, sheet: "component" });
              const edge = (event.target as HTMLElement).closest<HTMLElement>(
                "[data-edge]",
              )?.dataset.edge;
              const mode =
                edge === "l" ? "start" : edge === "r" ? "end" : "move";
              timing.begin(
                event,
                { kind: "component", id: component.id, mode },
                mode === "start"
                  ? component.at
                  : mode === "end"
                    ? component.at + componentLength(component, state.clips)
                    : undefined,
              );
            }}
            onPointerMove={timing.move}
            onPointerUp={endTiming}
            onPointerCancel={endTiming}
            onLostPointerCapture={endTiming}
            onClick={() => {
              setCodePreviewFocus(false);
              onSelect({ selComp: component.id, sheet: "component" });
            }}
          >
            {state.selComp === component.id && (
              <span className={styles.blockHandle} data-edge="l" />
            )}
            <span>✦ {componentLabel(component)}</span>
            <TimelineKeyframes animation={component.animation} color="#A78BFA" start={0} end={componentLength(component, state.clips)} />
            <DebugLayerIssue componentId={component.id} />
            {state.selComp === component.id && (
              <span className={styles.blockHandle} data-edge="r" />
            )}
          </button>
        );
      })}
    </div>
  );
}
