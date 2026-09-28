const STORAGE_KEY = "restyle.editor.advancedEditing";

export function readAdvancedEditing(): boolean {
  try {
    return globalThis.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function saveAdvancedEditing(enabled: boolean): boolean {
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, String(enabled));
    return true;
  } catch {
    return false;
  }
}
