/** Shared viewer input wiring for both plain video and interactive publications. */
export function bindPlaybackInputs({ refs, commands, signal }) {
  const on = (element, event, handler) => element.addEventListener(event, handler, { signal });
  on(refs.video, "click", commands.togglePlayback);
  on(refs.centerPlay, "click", commands.togglePlayback);
  on(refs.mute, "click", commands.toggleMute);
  refs.shares.forEach(button => on(button, "click", () => { void commands.shareExperience(); }));
  on(document, "keydown", event => {
    if (refs.shell.hidden || event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
    if (event.composedPath().some(node => ["INPUT", "SELECT", "TEXTAREA"].includes(node?.tagName)
        || node?.isContentEditable)) return;
    const key = event.key.toLowerCase();
    if (![" ", "k", "m"].includes(key)) return;
    if (key === " " && event.composedPath().some(node => ["BUTTON", "A"].includes(node?.tagName))) return;
    event.preventDefault();
    if (key === "m") commands.toggleMute();
    else commands.togglePlayback();
  });
}
