const STORAGE_KEY = "restyle.editor.reduceMotion";

export function readReduceMotion(): boolean {
  try {
    return globalThis.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function saveReduceMotion(enabled: boolean): boolean {
  try {
    globalThis.localStorage.setItem(STORAGE_KEY, String(enabled));
    return true;
  } catch {
    return false;
  }
}
