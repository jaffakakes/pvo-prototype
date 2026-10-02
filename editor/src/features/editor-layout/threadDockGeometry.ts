type Measurements = { height: number; header: number; playback: number };

/** The thread owns only the lower region; the player retains room to re-fit. */
export function threadDockMaximum(measurements: Measurements) {
  return Math.max(0, measurements.height - measurements.header - measurements.playback - 190);
}

/** Narrow phones need the outer navigation's space while the keyboard is present. */
export function threadDockMeasurements(measurements: Measurements, keyboardOpen: boolean) {
  return keyboardOpen && threadDockMaximum(measurements) < 240 ? { ...measurements, header: 0 } : measurements;
}

export function threadDockDefault(collapsed: boolean, keyboardOpen: boolean) {
  // The workspace already excludes the OS keyboard via visualViewport.
  if (keyboardOpen) return 290;
  return collapsed ? 322 : 480;
}
