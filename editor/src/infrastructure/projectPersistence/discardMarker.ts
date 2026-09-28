const KEY = "restyle-editor-project-discarded";

/** Synchronous marker closes the reset-versus-immediate-reload gap. */
export function markProjectDiscarded(): boolean {
  try {
    localStorage.setItem(KEY, "1");
    return true;
  } catch {
    return false;
  }
}

export function isProjectDiscarded(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function clearProjectDiscarded(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // A committed IndexedDB checkpoint is still the source of truth.
  }
}
