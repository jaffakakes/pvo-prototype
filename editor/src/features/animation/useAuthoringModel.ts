import { useState } from "react";
import { getAuthoringGroups, getAuthoringKeys, getAuthoringLayer, readAuthoringValue } from "../../domain/animation/authoring";
import type { AnimationTarget } from "../../domain/animation/model";
import { useCapture } from "../../state/captureStore";
import { useAssistant } from "../../state/assistant/assistantStore";
import { useAnimationSelection } from "../../state/animation/selection";

export function useAuthoringModel(target: AnimationTarget) {
  const state = useCapture();
  const assistantActive = useAssistant(value => value.phase !== "idle");
  const selected = useAnimationSelection(value => value.selection);
  const [error, setError] = useState<string | null>(null);
  const scene = state.scenes.find(item => item.id === state.currentSceneId);
  const layer = scene ? getAuthoringLayer(scene, target) : null;
  const groups = getAuthoringGroups(target);
  const rows = scene && layer ? groups.map(group => ({ group, keys: getAuthoringKeys(scene, target, group),
    value: readAuthoringValue(scene, target, group, state.t) })) : [];
  const sameTarget = selected?.sceneId === scene?.id && JSON.stringify(selected?.target) === JSON.stringify(target);
  const selectedRow = sameTarget ? rows.find(row => row.group === selected?.group) : undefined;
  const selectedKey = selectedRow?.keys.find(key => Math.abs(key.time - selected!.time) < .001);
  const blocked = assistantActive || !!state.tryMode || !!state.playheadPick || state.recording || state.importing || !!state.trim || state.ex === "running";
  const outside = !layer || state.t < layer.start - .001 || state.t > layer.end + .001;
  const perform = (operation: () => unknown) => {
    try { setError(null); return operation(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "This keyframe could not be updated."); return false; }
  };
  return { state, scene, layer, rows, selected: selectedKey && selectedRow ? { ...selectedKey, group: selectedRow.group } : null,
    count: rows.reduce((sum, row) => sum + row.keys.length, 0), blocked, disabled: blocked || outside, outside, error, perform };
}
