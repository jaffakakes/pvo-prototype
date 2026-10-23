import type { AnimationTarget } from "../../domain/animation/model";
import { selectedAuthoringTarget } from "../../state/animation/commands";
import { useCapture } from "../../state/captureStore";
import { ToolTray } from "../tool-trays/ToolTray";
import { AnimationSlider } from "../animation/AnimationValueControls";
import { AudioAnimationActions } from "../animation/AudioAnimationActions";
import { useAuthoringModel } from "../animation/useAuthoringModel";
import { formatKeyTime } from "../animation/presentation";
import styles from "../tool-trays/ToolTray.module.css";

export function VolumeTray() {
  const state = useCapture();
  const target = selectedAuthoringTarget(state);
  if (!target || target.kind === "text" || target.kind === "component")
    return (
      <ToolTray name="Volume">
        <p className={styles.error}>Select audio or a video clip.</p>
      </ToolTray>
    );
  return (
    <VolumeControls
      key={`${state.currentSceneId}:${target.kind}:${"id" in target ? target.id : "music"}`}
      target={target}
    />
  );
}

function VolumeControls({ target }: { target: AnimationTarget }) {
  const { state, layer, rows, disabled, blocked } = useAuthoringModel(target);
  const volume = rows.find((row) => row.group === "volume");
  if (!layer || !volume || typeof volume.value !== "number") return null;
  return (
    <ToolTray
      name="Volume"
      readout={`${layer.label} · ${formatKeyTime(layer.end - layer.start)}`}
    >
      <AnimationSlider
        target={target}
        group="volume"
        time={state.t}
        value={volume.value}
        disabled={disabled}
        ruler
      />
      <AudioAnimationActions target={target} disabled={blocked} />
    </ToolTray>
  );
}
