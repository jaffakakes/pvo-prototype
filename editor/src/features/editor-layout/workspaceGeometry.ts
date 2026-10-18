type Measurements = { height: number; header: number; playback: number };
const clampUnit = (value: number) => Math.max(0, Math.min(1, value));

/** Editing tools use one quarter; short timelines return unused space to playback. */
export function editorPanelHeight(
  measurements: Measurements,
  contentHeight?: number,
) {
  const quarter = Math.max(0, measurements.height - measurements.header) / 4;
  return contentHeight && contentHeight > 0
    ? Math.min(quarter, contentHeight)
    : quarter;
}

/** Space above the panel collapses in order: preview, playback, then navigation. */
export function workspaceGeometry(
  measurements: Measurements,
  panelHeight: number,
  open: boolean,
) {
  const remaining = Math.max(0, measurements.height - panelHeight);
  const header = Math.min(measurements.header, remaining);
  const playback = Math.min(
    measurements.playback,
    Math.max(0, remaining - header),
  );
  const preview = Math.max(0, remaining - header - playback);
  const previewOpacity = open ? clampUnit((preview - 40) / 72) : 1;
  const playbackOpacity = open
    ? clampUnit((playback - 32) / Math.max(1, measurements.playback - 32))
    : 1;
  const headerOpacity = open
    ? clampUnit((header - 32) / Math.max(1, measurements.header - 32))
    : 1;

  return {
    header,
    playback,
    preview,
    headerOpacity,
    playbackOpacity,
    previewOpacity,
    headerVisible: headerOpacity > 0,
    playbackVisible: playbackOpacity > 0,
    previewVisible: previewOpacity > 0,
  };
}
