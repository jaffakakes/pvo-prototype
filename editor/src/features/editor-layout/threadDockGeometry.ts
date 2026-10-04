type Measurements = { height: number; header: number; playback: number };
const PLAYER_MINIMUM = 190;
const KEYBOARD_THREAD_MINIMUM = 195;

/** Keep a usable player until the keyboard needs space for touch controls and composing. */
export function threadDockMaximum(measurements: Measurements, keyboardOpen = false) {
  const available = Math.max(0, measurements.height - measurements.header - measurements.playback);
  const playerMinimum = keyboardOpen
    ? Math.min(PLAYER_MINIMUM, Math.max(0, available - KEYBOARD_THREAD_MINIMUM))
    : PLAYER_MINIMUM;
  return Math.max(0, available - playerMinimum);
}

/** A small keyboard viewport borrows the navigation row for the conversation. */
export function threadDockMeasurements(measurements: Measurements, keyboardOpen: boolean) {
  return keyboardOpen && threadDockMaximum(measurements) < 240
    ? { ...measurements, header: 0 }
    : measurements;
}

export function threadDockDefault(collapsed: boolean, keyboardOpen: boolean) {
  if (keyboardOpen) return 290;
  return collapsed ? 322 : 480;
}
