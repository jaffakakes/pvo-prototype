import { useCapture } from "../../../state/captureStore";
import { openComponentDesign } from "../../../state/components/componentLayerCommands";
import { selectComponentSourcePart, setComponentAuthoringTab } from "../../../state/components/componentAuthoringStore";
import { setAdvancedEditingEnabled } from "../../../state/preferences/editorPreferences";
import { stopTry } from "../../preview/tryMode";
import { setDebugOpen, showDebugFeedback } from "../../try-debugger/uiStore";
import { clearDebugLocate } from "./debugLocate";

/** Reuse the normal Stop, scene selection and component-authoring commands. */
export function editDebugComponent(componentId: string, tab: "action" | "logic") {
  const state = useCapture.getState();
  const owner = state.scenes.find(scene => (scene.id === state.currentSceneId ? state.components : scene.components)
    .some(component => component.id === componentId));
  if (!owner) {
    showDebugFeedback("This component is no longer in the project.");
    return;
  }
  if (state.tryMode) stopTry();
  clearDebugLocate();
  setDebugOpen(false);
  const current = useCapture.getState();
  if (current.currentSceneId !== owner.id) current.switchScene(owner.id);
  openComponentDesign(componentId);
  if (tab === "logic") {
    setAdvancedEditingEnabled(true);
    selectComponentSourcePart(componentId, "logic");
  } else setComponentAuthoringTab(componentId, "action");
}
