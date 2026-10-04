import { getLayerTracking } from "../../../domain/animation/trackingMetadata";
import { getAuthoringLayer } from "../../../domain/animation/authoring";
import {
  addSelectedAuthoringKey,
  deleteSelectedAuthoringKey,
  selectedAuthoringTarget,
} from "../../../state/animation/commands";
import { useAnimationSelection } from "../../../state/animation/selection";
import { formatKeyTime } from "../../animation/presentation";
import { extractSelectedAudio } from "../../../state/editing/audioCommands";
import type { CSSProperties, ReactNode } from "react";
import { dur } from "../../../domain/clips/timing";
import { useCapture } from "../../../state/captureStore";
import { useAssistant } from "../../../state/assistant/assistantStore";
import {
  deleteTimelineSelection,
  duplicateTimelineSelection,
  splitSelectedClip,
  trimSelectionAtPlayhead,
  undoTimelineEdit,
} from "../../../state/editing/selectionCommands";
import { Icon } from "../../../ui/Icon";
import { fmt } from "../../../ui/formatTime";
import { componentLabel } from "../../../domain/components/presentation";
import { SOUNDS } from "../../sound/catalog";
import { MAX_ZOOM, MIN_ZOOM } from "./geometry";
import styles from "./TimelineToolbar.module.css";

type Props = {
  zoom: number;
  onZoom: (value: number) => void;
  snap: boolean;
  onSnap: () => void;
  assistant?: ReactNode;
};

const paths = {
  split: "M12 3v18M8 7l-4 5 4 5M16 7l4 5-4 5",
  left: "M4 4v16M20 12H9M13 8l-4 4 4 4",
  right: "M20 4v16M4 12h11M11 8l4 4-4 4",
  duplicate:
    "M8 8h12v12H8zM16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2",
  snap: "M5 3v8a7 7 0 0 0 14 0V3h-5v8a2 2 0 0 1-4 0V3zM5 7h5M14 7h5",
};

function Tool({
  label,
  icon,
  path,
  disabled,
  onClick,
  tone,
  keyframeControl = false,
}: {
  label: string;
  tone?: "keyframe" | "delete";
  keyframeControl?: boolean;
  icon?: string;
  path?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={styles.tool}
      title={label}
      data-tone={tone}
      data-keyframe-control={keyframeControl || undefined}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {path ? (
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d={path} />
        </svg>
      ) : (
        <Icon name={icon!} size={18} />
      )}
    </button>
  );
}

export function TimelineToolbar({
  zoom,
  onZoom,
  snap,
  onSnap,
  assistant,
}: Props) {
  const state = useCapture();
  const assistantActive = useAssistant((value) => value.phase !== "idle");
  const component = state.components.find((item) => item.id === state.selComp);
  const text = state.texts.find((item) => item.id === state.selText);
  const clip = state.clips[state.sel];
  const audio = state.sheet === "sound" && !!state.sound;
  const extracted = state.audioClips.find((item) => item.id === state.selAudio);
  const keySelection = useAnimationSelection((value) => value.selection);
  const animationTarget = selectedAuthoringTarget(state);
  const scene = state.scenes.find((item) => item.id === state.currentSceneId);
  const animationLayer =
    scene && animationTarget ? getAuthoringLayer(scene, animationTarget) : null;
  const tracking =
    scene && animationTarget ? getLayerTracking(scene, animationTarget) : null;
  const selected = !!(component || text || clip || audio || extracted);
  const label = extracted
    ? extracted.name
    : component
      ? `${componentLabel(component)} · ${fmt(component.at)}`
      : text
        ? text.text
        : clip
          ? `Clip ${state.sel + 1} · ${dur(clip).toFixed(1)}s`
          : audio
            ? SOUNDS[state.sound]?.name
            : "Nothing selected";
  const blocked = !!state.tryMode || !!state.playheadPick || assistantActive;
  return (
    <div
      className={styles.toolbar}
      role="toolbar"
      aria-label="Timeline editing"
    >
      <div className={styles.tools} {...(assistantActive ? { inert: "" } : {})}>
        <Tool
          label="Undo · Ctrl/⌘ Z"
          icon="undo"
          disabled={blocked || !state.past.length}
          onClick={() => undoTimelineEdit()}
        />
        <Tool
          label="Redo · Ctrl/⌘ Shift Z"
          icon="redo"
          disabled={blocked || !state.future.length}
          onClick={() => undoTimelineEdit(true)}
        />
        <span className={styles.separator} />
        <Tool
          label="Split at playhead · S"
          path={paths.split}
          disabled={blocked || (!clip && !extracted)}
          onClick={splitSelectedClip}
        />
        <Tool
          label="Delete left of playhead"
          path={paths.left}
          disabled={blocked || !clip}
          onClick={() => trimSelectionAtPlayhead("l")}
        />
        <Tool
          label="Delete right of playhead"
          path={paths.right}
          disabled={blocked || !clip}
          onClick={() => trimSelectionAtPlayhead("r")}
        />
        <span className={styles.separator} />
        <Tool
          label="Duplicate selection · Ctrl/⌘ D"
          path={paths.duplicate}
          disabled={blocked || !selected || audio}
          onClick={duplicateTimelineSelection}
        />
        <Tool
          label="Extract audio"
          icon="music"
          disabled={blocked || !clip?.url || !!clip.audioDetached}
          onClick={extractSelectedAudio}
        />
        <Tool
          label={
            keySelection
              ? "Delete keyframe · Backspace"
              : "Delete selection · Backspace"
          }
          tone={keySelection ? "delete" : undefined}
          keyframeControl={!!keySelection}
          icon="delete"
          disabled={blocked || !selected}
          onClick={() => {
            if (!deleteSelectedAuthoringKey()) deleteTimelineSelection();
          }}
        />
        <Tool
          label={`Add keyframe at ${formatKeyTime(state.t)} · K`}
          path="M12 3l9 9-9 9-9-9z"
          tone="keyframe"
          keyframeControl
          disabled={blocked || !animationTarget}
          onClick={() => {
            addSelectedAuthoringKey();
          }}
        />
        <span
          style={
            { "--selection-color": animationLayer?.color } as CSSProperties
          }
          className={styles.selection}
          data-selected={selected}
          title={label}
        >
          {label}
        </span>
      </div>
      <div className={styles.right}>
        <button
          className={styles.tool}
          data-active={snap}
          aria-label="Snap to edges"
          aria-pressed={snap}
          title="Snap to edges"
          onClick={onSnap}
          disabled={assistantActive}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d={paths.snap} />
          </svg>
        </button>
        <button
          className={styles.tool}
          aria-label="Zoom timeline out"
          disabled={assistantActive || zoom <= MIN_ZOOM}
          onClick={() => onZoom(Math.max(MIN_ZOOM, zoom - 12))}
        >
          −
        </button>
        <input
          className={styles.zoom}
          type="range"
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          value={zoom}
          disabled={assistantActive}
          aria-label="Timeline zoom"
          onChange={(event) => onZoom(Number(event.target.value))}
        />
        <button
          className={styles.tool}
          aria-label="Zoom timeline in"
          disabled={assistantActive || zoom >= MAX_ZOOM}
          onClick={() => onZoom(Math.min(MAX_ZOOM, zoom + 12))}
        >
          +
        </button>
        {tracking && (
          <span
            className={styles.following}
            data-following-status
            title={`Following ${tracking.label}`}
          >
            <i aria-hidden="true" />✦ Following {tracking.label}
          </span>
        )}
        {assistant && (
          <>
            <span className={styles.separator} />
            <div className={styles.assistant}>{assistant}</div>
          </>
        )}
      </div>
    </div>
  );
}
