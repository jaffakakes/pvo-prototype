import { useState } from "react";
import type { Scene, Ratio } from "../../domain/project/model";
import { exportCoverAt } from "../../domain/project/cover";
import { sceneDuration } from "../../domain/scenes/duration";
import { saveProjectCover } from "../../state/editing/coverCommands";
import { FramePicker } from "../frame-picker/FramePicker";

export function CoverPicker({
  scene,
  ratio,
  initialTime,
  onClose,
}: {
  scene: Scene;
  ratio: Ratio;
  initialTime: number;
  onClose(): void;
}) {
  const [time, setTime] = useState(initialTime);
  const shownTime = exportCoverAt({ scenes: [scene], coverAt: time });
  return (
    <FramePicker
      scene={scene}
      ratio={ratio}
      time={shownTime}
      maximum={Math.max(0, sceneDuration(scene) - 1 / 30)}
      label="Choose cover"
      sliderLabel="Pick a cover frame"
      closeLabel="Close cover picker"
      onTime={setTime}
      onSave={() => {
        saveProjectCover(shownTime);
        onClose();
      }}
      onClose={onClose}
    />
  );
}
