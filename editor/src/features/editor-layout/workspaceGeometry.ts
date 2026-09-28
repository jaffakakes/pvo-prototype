type Measurements = { height: number; header: number; playback: number };
const clampUnit = (value: number) => Math.max(0, Math.min(1, value));

/** Component tools retain navigation, transport and enough video for direct placement. */
export function componentPanelMaximum(measurements: Measurements, width: number) {
  const minimumPlayer = width <= 340 ? 150 : 190;
  return Math.max(0, measurements.height - measurements.header - measurements.playback - minimumPlayer);
}

export function keyboardPanelHeight(height: number, maximum: number, keyboardHeight: number) {
  return Math.min(maximum, Math.max(height, keyboardHeight + 290));
}

/** Space above the panel collapses in order: preview, playback, then navigation. */
export function workspaceGeometry(measurements: Measurements, panelHeight: number, open: boolean) {
  const remaining = Math.max(0, measurements.height - panelHeight);
  const header = Math.min(measurements.header, remaining);
  const playback = Math.min(measurements.playback, Math.max(0, remaining - header));
  const preview = Math.max(0, remaining - header - playback);
  const previewOpacity = open ? clampUnit((preview - 40) / 72) : 1;
  const playbackOpacity = open ? clampUnit((playback - 32) / Math.max(1, measurements.playback - 32)) : 1;
  const headerOpacity = open ? clampUnit((header - 32) / Math.max(1, measurements.header - 32)) : 1;

  return {
    header, playback, preview,
    headerOpacity, playbackOpacity, previewOpacity,
    headerVisible: headerOpacity > 0,
    playbackVisible: playbackOpacity > 0,
    previewVisible: previewOpacity > 0,
  };
}
