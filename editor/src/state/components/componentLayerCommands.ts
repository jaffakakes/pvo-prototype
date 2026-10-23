import { isVisualEditingBlocked } from "../../domain/components/codeOwnership";
import { useCapture } from "../captureStore";
import type { SheetName } from "../types";
import {
  selectComponentSourcePart,
  setComponentAuthoringTab,
} from "./componentAuthoringStore";
import { setAdvancedEditingEnabled } from "../preferences/editorPreferences";

export const COMPONENT_LAYER_TOOLS = {
  opacity: "componentOpacity",
  transform: "crop",
  timing: "componentTiming",
} as const;
export type ComponentLayerTool = keyof typeof COMPONENT_LAYER_TOOLS;
export function componentLayerTool(
  sheet: SheetName,
): ComponentLayerTool | null {
  return (
    (Object.keys(COMPONENT_LAYER_TOOLS) as ComponentLayerTool[]).find(
      (tool) => COMPONENT_LAYER_TOOLS[tool] === sheet,
    ) ?? null
  );
}
export function selectComponentLayer(id: string) {
  const state = useCapture.getState();
  if (
    state.tryMode ||
    state.playheadPick ||
    !state.components.some((item) => item.id === id)
  )
    return;
  state.patch({
    selComp: id,
    sel: -1,
    selText: null,
    selAudio: null,
    selMusic: false,
    orb: false,
    ...((state.selComp !== id || state.sheet === "component") &&
    state.sheet !== "crop" &&
    state.sheet !== "keyframes"
      ? { sheet: null }
      : {}),
  });
}
export function openComponentLayerTool(tool: ComponentLayerTool) {
  const state = useCapture.getState();
  if (state.tryMode || state.playheadPick || !state.selComp) return;
  state.patch({
    sheet: COMPONENT_LAYER_TOOLS[tool],
    orb: false,
    playing: false,
  });
}
export function openComponentDesign(componentId?: string) {
  const state = useCapture.getState();
  const component = state.components.find(
    (item) => item.id === (componentId ?? state.selComp),
  );
  if (!component || state.tryMode) return;
  if (isVisualEditingBlocked(component)) {
    setAdvancedEditingEnabled(true);
    selectComponentSourcePart(component.id, "structure");
  } else setComponentAuthoringTab(component.id, "look");
  state.patch({
    sel: -1,
    selText: null,
    selComp: component.id,
    sheet: "component",
    playing: false,
    orb: false,
    ratioMenu: false,
  });
}
