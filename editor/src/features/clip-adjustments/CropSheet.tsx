import { selectedAuthoringTarget } from "../../state/animation/access";
import { resetSelectedLayerTransform } from "../../state/editing/resetLayerTransform";
import type { StageAnimationTarget } from "../../state/animation/stageGesture";
import { useCapture } from "../../state/captureStore";
import {
  adjustSelectedClip,
  setSelectedClipFraming,
} from "../../state/editing/clipAdjustmentCommands";
import { Icon } from "../../ui/Icon";
import {
  AnimationSlider,
  PositionPad,
} from "../animation/AnimationValueControls";
import { useAuthoringModel } from "../animation/useAuthoringModel";
import { ToolTray } from "../tool-trays/ToolTray";
import styles from "./CropSheet.module.css";

export function CropSheet() {
  const state = useCapture();
  const target = selectedAuthoringTarget(state);
  if (!target || target.kind === "audio" || target.kind === "music")
    return null;
  return (
    <CropControls
      key={`${state.currentSceneId}:${target.kind}:${target.id}`}
      target={target}
    />
  );
}

function CropControls({ target }: { target: StageAnimationTarget }) {
  const { state, rows, blocked, disabled } = useAuthoringModel(target);
  const clip =
    target.kind === "clip"
      ? state.clips.find((item) => item.id === target.id)
      : undefined;
  const position = rows.find((row) => row.group === "position");
  const opacity = rows.find((row) => row.group === "opacity");
  return (
    <ToolTray name={clip ? "Crop" : "Transform"} caption={false}>
      <div className={styles.buttons}>
        {clip && (
          <>
            <button
              disabled={blocked}
              aria-pressed={clip.fit === "contain"}
              onClick={() => setSelectedClipFraming("contain")}
            >
              Fit
            </button>
            <button
              disabled={blocked}
              aria-pressed={clip.fit === "cover"}
              onClick={() => setSelectedClipFraming("cover")}
            >
              Fill
            </button>
            <button
              disabled={blocked}
              aria-pressed={!!clip.mirror}
              onClick={() => adjustSelectedClip({ mirror: !clip.mirror })}
            >
              <Icon name="mirror" size={14} /> Mirror
            </button>
          </>
        )}
        <button
          disabled={blocked}
          onClick={() => resetSelectedLayerTransform(target)}
        >
          Reset
        </button>
      </div>
      <div className={styles.controls}>
        {position && (
          <PositionPad
            target={target}
            time={state.t}
            value={position.value}
            disabled={disabled}
          />
        )}
        <div className={styles.details}>
          {opacity && typeof opacity.value === "number" && (
            <AnimationSlider
              target={target}
              group="opacity"
              time={state.t}
              value={opacity.value}
              disabled={disabled}
              ruler
            />
          )}
          <p>Drag to move · Pinch &amp; twist</p>
        </div>
      </div>
    </ToolTray>
  );
}
