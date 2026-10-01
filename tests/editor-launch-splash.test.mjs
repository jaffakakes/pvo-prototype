import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";

const bundled = buildSync({
  stdin: {
    contents: 'export * from "./editor/src/features/launch-splash/launchSplashTimeline.ts";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
});
const timeline = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

test("launch splash waits for the first complete beat after the minimum", () => {
  assert.equal(timeline.nextLaunchSplashBeatBoundary(0), 2700);
  assert.equal(timeline.nextLaunchSplashBeatBoundary(1400), 2700);
  assert.equal(timeline.nextLaunchSplashBeatBoundary(2699.9), 2700);
  assert.equal(timeline.nextLaunchSplashBeatBoundary(2700), 2700);
  assert.equal(timeline.nextLaunchSplashBeatBoundary(2700.1), 4800);
  assert.equal(timeline.nextLaunchSplashBeatBoundary(7000), 9000);
});

test("launch splash timing keeps the approved phase durations", () => {
  assert.equal(timeline.LAUNCH_SPLASH_INTRO_MS, 600);
  assert.equal(timeline.LAUNCH_SPLASH_BEAT_MS, 2100);
  assert.equal(timeline.LAUNCH_SPLASH_MINIMUM_MS, 1400);
  assert.equal(timeline.LAUNCH_SPLASH_REVEAL_MS, 800);
  assert.equal(timeline.LAUNCH_SPLASH_REDUCED_REVEAL_MS, 200);
});
