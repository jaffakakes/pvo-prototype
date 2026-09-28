import { create } from "zustand";
import { readAdvancedEditing, saveAdvancedEditing } from "../../infrastructure/preferences/advancedEditing";
import { readReduceMotion, saveReduceMotion } from "../../infrastructure/preferences/reduceMotion";

type EditorPreferences = {
  advancedEditingEnabled: boolean;
  reduceMotion: boolean;
  storageSaveFailed: boolean;
};

// Device preferences are independent of project snapshots, undo and project resets.
export const useEditorPreferences = create<EditorPreferences>(() => ({
  advancedEditingEnabled: readAdvancedEditing(),
  reduceMotion: readReduceMotion(),
  storageSaveFailed: false,
}));

export function setReduceMotion(enabled: boolean) {
  const saved = saveReduceMotion(enabled);
  useEditorPreferences.setState({ reduceMotion: enabled, storageSaveFailed: !saved });
}

export function setAdvancedEditingEnabled(enabled: boolean) {
  const saved = saveAdvancedEditing(enabled);
  useEditorPreferences.setState({
    advancedEditingEnabled: enabled,
    storageSaveFailed: !saved,
  });
}
