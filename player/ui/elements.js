/** Resolve the shell once; controllers receive only the elements they use. */
export function readPlayerElements() {
  const ids = {
    input: "pvoInput", empty: "emptyState", dropZone: "dropZone", shell: "playerShell",
    openStatus: "openStatus", openDetails: "openErrorDetails", openError: "openErrorMessage",
    frame: "playerFrame", video: "video", overlay: "overlayLayer", ambient: "ambientCanvas",
    endScreen: "endScreen", endRestart: "endRestartButton", centerPlay: "centerPlayButton",
    mute: "muteButton", soundIcon: "soundIcon", soundLabel: "soundLabel",
    statusWidget: "statusWidget", holdStatus: "holdStatus", holdBadge: "holdBadge",
    holdLabel: "holdLabel", holdArrow: "holdArrow", retry: "retryButton",
    keyboardDone: "keyboardDoneButton", brand: "brandSticker", brandCreate: "brandCreateLink", timeline: "timelineLabel", status: "status",
  };
  return {
    ...Object.fromEntries(Object.entries(ids).map(([name, id]) => [name, document.getElementById(id)])),
    shares: [...document.querySelectorAll("[data-player-share]")],
    titles: [...document.querySelectorAll("[data-player-title]")],
    metadata: [...document.querySelectorAll("[data-player-meta]")],
  };
}
