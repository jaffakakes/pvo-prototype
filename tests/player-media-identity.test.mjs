import assert from "node:assert/strict";
import test from "node:test";
import { createVideoController } from "../player/media/video.js";
import { createPlaybackSession } from "../player/playback/session.js";

test("successive projects with the same asset ID load their actual URL", async () => {
  const session = createPlaybackSession();
  session.currentTimeline = {
    clips: [{ asset_id: "video", start: 0, end: 2 }],
  };
  session.assets.set("video", {});
  const video = Object.assign(new EventTarget(), {
    dataset: {},
    src: "",
    loads: 0,
    pause() {},
    load() {
      this.loads++;
      queueMicrotask(() => this.dispatchEvent(new Event("loadedmetadata")));
    },
  });
  const controller = createVideoController({
    session,
    refs: { video },
    adapters: {
      updateTimelineLabel() {},
      renderOverlays() {},
      updateProgress() {},
    },
  });
  for (const url of ["blob:first-project", "blob:second-project"]) {
    session.assetUrls.set("video", url);
    await controller.loadClip(0);
    assert.equal(video.src, url);
  }
  assert.equal(video.loads, 2);
  await controller.loadClip(0);
  assert.equal(
    video.loads,
    2,
    "A seek within the same media doesn't reload it",
  );
});
