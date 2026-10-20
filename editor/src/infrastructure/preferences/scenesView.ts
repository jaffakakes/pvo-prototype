export type ScenesView = "tree" | "map";
const key = "restyle.scenes.view";
export function readScenesView(): ScenesView {
  try {
    return globalThis.localStorage.getItem(key) === "map" ? "map" : "tree";
  } catch {
    return "tree";
  }
}
export function saveScenesView(view: ScenesView): void {
  try {
    globalThis.localStorage.setItem(key, view);
  } catch {
    /* A blocked preference store must not prevent scene navigation. */
  }
}
