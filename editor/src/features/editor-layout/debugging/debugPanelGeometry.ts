/** Diagnostic panels never consume the player or its transport. */
export function mobileDebugPanelGeometry(available: number) {
  const maximum = Math.max(0, available - 150);
  return {
    minimum: Math.min(220, maximum),
    initial: Math.min(maximum, 404, Math.round(available * 0.52)),
    expanded: Math.max(0, available - 180),
    maximum,
  };
}

export function desktopDebugPanelGeometry(bodyHeight: number, viewportHeight: number) {
  const maximum = Math.max(0, bodyHeight - 308);
  const preferred = viewportHeight <= 800 ? Math.max(300, Math.min(364, viewportHeight * 0.42)) : 364;
  return { maximum, minimum: Math.min(260, maximum), initial: Math.min(preferred, maximum) };
}
