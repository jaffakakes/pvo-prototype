/** Resolve the player shell once; controllers receive only the elements they use. */
export function readPlayerElements() {
  return {
  input: document.querySelector("#pvoInput"),
  empty: document.querySelector("#emptyState"),
  dropZone: document.querySelector("#dropZone"),
  shell: document.querySelector("#playerShell"),
  frame: document.querySelector("#playerFrame"),
  video: document.querySelector("#video"),
  overlay: document.querySelector("#overlayLayer"),
  endScreen: document.querySelector("#endScreen"),
  endRestart: document.querySelector("#endRestartButton"),
  centerPlay: document.querySelector("#centerPlayButton"),
  controls: document.querySelector("#playerControls"),
  restart: document.querySelector("#restartButton"),
  play: document.querySelector("#playButton"),
  mute: document.querySelector("#muteButton"),
  volume: document.querySelector("#volumeControl"),
  progress: document.querySelector("#progress"),
  fullscreen: document.querySelector("#fullscreenButton"),
  share: document.querySelector("#shareButton"),
  endShare: document.querySelector("#endShareButton"),
  timeline: document.querySelector("#timelineLabel"),
  time: document.querySelector("#timeLabel"),
  status: document.querySelector("#status"),
};
}
