import { usePanelResize } from "./usePanelResize";
import { threadDockDefault, threadDockMaximum, threadDockMeasurements } from "./threadDockGeometry";

type Options = {
  measurements: { height: number; header: number; playback: number };
  collapsed: boolean;
  keyboardHeight: number;
  onClose?(): void;
};

/** Each presentation keeps its preferred size, so keyboard fitting cannot overwrite a user's drag. */
export function useThreadDock({ measurements, collapsed, keyboardHeight, onClose }: Options) {
  const layoutMeasurements = threadDockMeasurements(measurements, keyboardHeight > 0);
  const maximum = threadDockMaximum(layoutMeasurements);
  const normalMaximum = threadDockMaximum({ ...measurements, height: measurements.height + keyboardHeight });
  const shared = { minimum: 180, dismissBelow: 120, dismiss: onClose };
  const expanded = usePanelResize({ ...shared, maximum: normalMaximum, initial: threadDockDefault(false, false) });
  const compact = usePanelResize({ ...shared, maximum: normalMaximum, initial: threadDockDefault(true, false) });
  const keyboard = usePanelResize({ ...shared, maximum, initial: threadDockDefault(collapsed, true) });
  const resize = keyboardHeight > 0 ? keyboard : collapsed ? compact : expanded;
  return { resize, maximum, measurements: layoutMeasurements, compact: layoutMeasurements !== measurements };
}
