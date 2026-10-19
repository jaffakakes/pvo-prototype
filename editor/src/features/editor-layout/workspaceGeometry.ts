type Measurements = { height: number; header: number; playback: number };
const clampUnit = (value: number) => Math.max(0, Math.min(1, value));

export function aspectRatioPanelHeight(height: number) {
  return height < 500 ? 112 : Math.min(180, Math.max(156, height * 0.24));
}

/** Keep the normal split, with usable timeline space on short screens. */
export function editorPanelHeight(
  measurements: Measurements,
  ratioOpen = false,
) {
  const normal =
    (Math.max(0, measurements.height - measurements.header) * 3) / 8;
  const ratioPanel = aspectRatioPanelHeight(measurements.height);
  const shortScreen =
    measurements.height < 500
      ? Math.min(
          244,
          Math.max(
            0,
            measurements.height -
              measurements.header -
              measurements.playback -
              40,
          ),
        )
      : 0;
  return ratioOpen
    ? Math.max(normal, ratioPanel + 132)
    : Math.max(normal, shortScreen);
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
