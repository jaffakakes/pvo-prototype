import { CropSheet } from "../features/clip-adjustments/CropSheet";
import { EasingTray } from "../features/animation/EasingTray";
import { SpeedSheet } from "../features/clip-adjustments/SpeedSheet";
import { ComponentsSheets } from "../features/component-authoring/ComponentsSheets";
import { ComponentLayerSheet } from "../features/component-layer/ComponentLayerSheet";
import { ComponentTimingPicker } from "../features/component-layer/ComponentTimingPicker";
import { DiscardSheet } from "../features/create-project/DiscardSheet";
import { ExportSheet } from "../features/export/ExportSheet";
import { ReplyInbox } from "../features/replies/ReplyInbox";
import { SoundEffectsSheet } from "../features/sound/SoundEffectsSheet";
import { SoundSheet } from "../features/sound/SoundSheet";
import { TextSheet } from "../features/text/TextSheet";
import { TextTimingSheet } from "../features/text/TextTimingSheet";
import { useCapture } from "../state/captureStore";
import { Shell } from "../ui/SheetShell";
import { VolumeTray } from "../features/sound/VolumeTray";
import { isEditorToolTray } from "../features/tool-trays/EditorToolDock";

export function Sheets({ trays = false }: { trays?: boolean }) {
  const sheet = useCapture((state) => state.sheet);
  if (trays && isEditorToolTray(sheet)) return null;
  switch (sheet) {
    case null:
      return null;
    case "components":
    case "component":
      return <ComponentsSheets />;
    case "text":
      return <TextSheet />;
    case "textTiming":
      return <TextTimingSheet />;
    case "replies":
      return (
        <Shell title="Replies">
          <ReplyInbox />
        </Shell>
      );
    case "export":
      return <ExportSheet />;
    case "speed":
      return <SpeedSheet />;
    case "crop":
      return <CropSheet />;
    case "ratio":
    case "voiceover":
      return null;
    case "componentOpacity":
      return <ComponentLayerSheet />;
    case "componentTiming":
      return <ComponentTimingPicker />;
    case "soundEffects":
      return <SoundEffectsSheet />;
    case "sound":
      return <SoundSheet />;
    case "keyframes":
      return <EasingTray />;
    case "volume":
      return <VolumeTray />;
    case "volumeKeyframes":
      return <EasingTray />;
    case "discard":
      return <DiscardSheet />;
  }
}
