import type { CaptureState } from "../../../state/types";
import { clearTimelineSelection } from "../../../state/editing/selectionCommands";
import { componentLength } from "../../../domain/components/timing";
import { dur } from "../../../domain/clips/timing";
import { nameOf } from "../../component-authoring/catalog";
import { componentLabel } from "../../preview/ComponentOverlay";
import { useTimingPointer } from "../../timeline/useTimingPointer";
import { ClipPoster } from "../../../ui/media/ClipPoster";
import { Icon } from "../../../ui/Icon";
import styles from "./DesktopTimeline.module.css";
import type { DesktopLayerRow } from "./layerRows";

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

export function DesktopVisualLayerLabels({
  rows,
  components,
  texts,
}: {
  rows: DesktopLayerRow[];
  components: CaptureState["components"];
  texts: CaptureState["texts"];
}) {
  return rows.map((row) => {
    if (row.kind === "empty-components")
      return (
        <div
          key={row.id}
          className={styles.label}
          data-kind="components"
          data-desktop-layer-label={row.id}
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
          data-layer-id={row.layerId}
        >
          <Icon name="pvoExport" size={16} />
          <div>
            Video<small>Main track</small>
          </div>
        </div>
      );
    if (row.kind === "component") {
      const component = components.find(
        (item) => row.layerId === `component:${item.id}`,
      );
      if (!component) return null;
      return (
        <div
          key={row.id}
          className={styles.label}
          data-kind="components"
          data-desktop-layer-label={row.id}
          data-layer-id={row.layerId}
          title={componentLabel(component)}
        >
          <span>✦</span>
          <span className={styles.labelText}>{nameOf(component.type)}</span>
        </div>
      );
    }
    const text = texts.find((item) => row.layerId === `text:${item.id}`);
    if (!text) return null;
    return (
      <div
        key={row.id}
        className={styles.label}
        data-kind="text"
        data-desktop-layer-label={row.id}
        data-layer-id={row.layerId}
        title={text.text}
      >
        <span>T</span>
        <span className={styles.labelText}>Text</span>
      </div>
    );
  });
}

export function DesktopVisualLayerLanes({
  rows,
  state,
  zoom,
  clipEnds,
  editingBlocked,
  sceneName,
  timing,
  onOpenLibrary,
  onSelect,
}: {
  rows: DesktopLayerRow[];
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

  return rows.map((row) => {
    if (row.kind === "empty-components")
      return (
        <div
          key={row.id}
          className={styles.lane}
          data-kind="components"
          data-desktop-layer-lane={row.id}
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
        >
          {emptyLane("text", "T Add text")}
        </div>
      );
    if (row.kind === "component") {
      const component = state.components.find(
        (item) => row.layerId === `component:${item.id}`,
      );
      if (!component) return null;
      return (
        <div
          key={row.id}
          className={styles.lane}
          data-kind="components"
          data-desktop-layer-lane={row.id}
          data-layer-id={row.layerId}
          onClick={(event) => {
            if (event.target === event.currentTarget)
              clearTimelineSelection();
          }}
        >
          <button
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
            onPointerUp={timing.end}
            onPointerCancel={timing.end}
            onLostPointerCapture={timing.end}
            onClick={() =>
              onSelect({ selComp: component.id, sheet: "component" })
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
        </div>
      );
    }
    if (row.kind === "text") {
      const text = state.texts.find(
        (item) => row.layerId === `text:${item.id}`,
      );
      if (!text) return null;
      return (
        <div
          key={row.id}
          className={styles.lane}
          data-kind="text"
          data-desktop-layer-lane={row.id}
          data-layer-id={row.layerId}
          onClick={(event) => {
            if (event.target === event.currentTarget)
              clearTimelineSelection();
          }}
        >
          <button
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
            onPointerUp={timing.end}
            onPointerCancel={timing.end}
            onLostPointerCapture={timing.end}
            onClick={() => onSelect({ selText: text.id, sheet: "text" })}
          >
            {state.selText === text.id && (
              <span className={styles.blockHandle} data-edge="l" />
            )}
            <span>T {text.text}</span>
            {state.selText === text.id && (
              <span className={styles.blockHandle} data-edge="r" />
            )}
          </button>
        </div>
      );
    }
    return (
      <div
        key={row.id}
        className={styles.videoLane}
        data-desktop-layer-lane={row.id}
        data-layer-id={row.layerId}
        onClick={(event) => {
          if (event.target === event.currentTarget) clearTimelineSelection();
        }}
      >
        {!state.clips.length ? (
          <button
            className={styles.addScene}
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
  });
}
