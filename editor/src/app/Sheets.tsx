import { CropSheet } from "../features/clip-adjustments/CropSheet";
import { SpeedSheet } from "../features/clip-adjustments/SpeedSheet";
import { ComponentsSheets } from "../features/component-authoring/ComponentsSheets";
import { DiscardSheet } from "../features/create-project/DiscardSheet";
import { ExportSheet } from "../features/export/ExportSheet";
import { MoreSettings } from "../features/settings/MoreSettings";
import { SoundSheet } from "../features/sound/SoundSheet";
import { TextSheet } from "../features/text/TextSheet";
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
    case "sound":
      return <SoundSheet />;
    case "discard":
      return <DiscardSheet />;
  }
}
