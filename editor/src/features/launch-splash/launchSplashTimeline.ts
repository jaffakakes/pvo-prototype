export const LAUNCH_SPLASH_INTRO_MS = 600;
export const LAUNCH_SPLASH_BEAT_MS = 2100;
export const LAUNCH_SPLASH_MINIMUM_MS = 1400;
export const LAUNCH_SPLASH_REVEAL_MS = 800;
export const LAUNCH_SPLASH_REDUCED_REVEAL_MS = 200;

/** Return the first complete wait-beat boundary at or after launch is eligible. */
export function nextLaunchSplashBeatBoundary(elapsedMs: number): number {
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const eligible = Math.max(LAUNCH_SPLASH_MINIMUM_MS, elapsed);
  const completedBeats = Math.ceil(
    (eligible - LAUNCH_SPLASH_INTRO_MS) / LAUNCH_SPLASH_BEAT_MS,
  );
  return LAUNCH_SPLASH_INTRO_MS + completedBeats * LAUNCH_SPLASH_BEAT_MS;
}
