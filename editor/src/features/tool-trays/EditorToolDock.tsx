import { useCapture } from "../../state/captureStore";
import { SpeedSheet } from "../clip-adjustments/SpeedSheet";
import { CropSheet } from "../clip-adjustments/CropSheet";
import { VolumeTray } from "../sound/VolumeTray";
import { EasingTray } from "../animation/EasingTray";

const trayTools = new Set([
  "speed",
  "crop",
  "volume",
  "keyframes",
  "volumeKeyframes",
]);
export const isEditorToolTray = (tool: string | null) =>
  !!tool && trayTools.has(tool);

export function EditorToolDock() {
  const tool = useCapture((state) => state.sheet);
  if (tool === "speed") return <SpeedSheet />;
  if (tool === "crop") return <CropSheet />;
  if (tool === "volume") return <VolumeTray />;
  if (tool === "keyframes" || tool === "volumeKeyframes") return <EasingTray />;
  return null;
}
