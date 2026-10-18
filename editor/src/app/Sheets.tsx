import { CropSheet } from "../features/clip-adjustments/CropSheet";
import { AnimationSheet } from "../features/animation/AnimationSheet";
import { SpeedSheet } from "../features/clip-adjustments/SpeedSheet";
import { ComponentsSheets } from "../features/component-authoring/ComponentsSheets";
import { DiscardSheet } from "../features/create-project/DiscardSheet";
import { ExportSheet } from "../features/export/ExportSheet";
import { MoreSettings } from "../features/settings/MoreSettings";
import { SoundEffectsSheet } from "../features/sound/SoundEffectsSheet";
import { SoundSheet } from "../features/sound/SoundSheet";
import { TextSheet } from "../features/text/TextSheet";
import { TextTimingSheet } from "../features/text/TextTimingSheet";
import { useCapture } from "../state/captureStore";
import { Shell } from "../ui/SheetShell";

export function Sheets() {
  const sheet = useCapture((state) => state.sheet);
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
    case "more":
      return (
        <Shell title="More" sub="Editor and PVO settings">
          <MoreSettings />
        </Shell>
      );
    case "export":
      return <ExportSheet />;
    case "speed":
      return <SpeedSheet />;
    case "crop":
      return <CropSheet />;
    case "voiceover":
      return null;
    case "soundEffects":
      return <SoundEffectsSheet />;
    case "sound":
      return <SoundSheet />;
    case "animation":
      return <AnimationSheet />;
    case "discard":
      return <DiscardSheet />;
  }
}
