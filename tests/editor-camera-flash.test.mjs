import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";

const bundled = buildSync({
  entryPoints: ["editor/src/features/capture/cameraFlash.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
});
const { cameraFlashMode, setCameraTorch } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);

function camera({
  facingMode = "environment",
  torch = true,
  settingsTorch = false,
  constraints = {},
  apply,
} = {}) {
  const calls = [];
  const settings = { facingMode, torch: settingsTorch };
  let currentConstraints = structuredClone(constraints);
  const track = {
    readyState: "live",
    stop: () => {
      track.readyState = "ended";
      settings.torch = false;
    },
    getCapabilities: () => ({ torch }),
    getSettings: () => ({ ...settings }),
    getConstraints: () => structuredClone(currentConstraints),
    applyConstraints: async (next) => {
      calls.push(structuredClone(next));
      const enabled = next.advanced.at(-1).torch;
      if (apply) await apply(enabled, settings);
      else settings.torch = enabled;
      currentConstraints = structuredClone(next);
    },
  };
  return { track, calls, settings };
}

test("screen light follows actual facing before requested facing", () => {
  const front = camera({ facingMode: "user", torch: false });
  assert.equal(cameraFlashMode(front.track, "environment"), "screen");
  const rear = camera({ facingMode: "environment", torch: false });
  assert.equal(cameraFlashMode(rear.track, "user"), null);
  const unreported = camera({ facingMode: "" });
  assert.equal(cameraFlashMode(unreported.track, "user"), "screen");
  assert.equal(cameraFlashMode(unreported.track, "environment"), "torch");
});

test("rear flash requires a controllable capability and reported setting", () => {
  for (const torch of [true, [true, false], [false, true]]) {
    assert.equal(
      cameraFlashMode(camera({ torch }).track, "environment"),
      "torch",
    );
  }
  for (const torch of [false, undefined, [], [false], [true], "true"]) {
    const fixture = camera();
    fixture.track.getCapabilities = () => ({ torch });
    assert.equal(cameraFlashMode(fixture.track, "environment"), null);
  }
  const missingSetting = camera();
  missingSetting.track.getSettings = () => ({ facingMode: "environment" });
  assert.equal(cameraFlashMode(missingSetting.track, "environment"), null);
});

test("unavailable capability APIs and ended tracks do not expose flash", () => {
  assert.equal(cameraFlashMode(null, "user"), null);
  const fixture = camera();
  fixture.track.getCapabilities = undefined;
  assert.equal(cameraFlashMode(fixture.track, "environment"), null);
  fixture.track.getSettings = () => {
    throw new Error("Camera unavailable");
  };
  assert.equal(cameraFlashMode(fixture.track, "user"), null);
  fixture.track.readyState = "ended";
  assert.equal(cameraFlashMode(fixture.track, "user"), null);
});

test("torch updates preserve camera quality and zoom without conflicting torch constraints", async () => {
  const fixture = camera({
    constraints: {
      facingMode: "environment",
      width: { ideal: 1920 },
      frameRate: { ideal: 30 },
      torch: { exact: false },
      advanced: [{ zoom: 2, torch: false }, { torch: { exact: false } }],
    },
  });
  await setCameraTorch(fixture.track, true);
  assert.deepEqual(fixture.calls, [
    {
      facingMode: "environment",
      width: { ideal: 1920 },
      frameRate: { ideal: 30 },
      advanced: [{ zoom: 2 }, { torch: true }],
    },
  ]);
  await setCameraTorch(fixture.track, false);
  assert.deepEqual(fixture.calls[1].advanced, [{ zoom: 2 }, { torch: false }]);
  assert.equal(fixture.settings.torch, false);
});

test("a resolved but ignored activation is reported as failure", async () => {
  const fixture = camera({ apply: async () => {} });
  await assert.rejects(setCameraTorch(fixture.track, true), (error) => {
    assert.match(error.message, /turn the camera torch on/);
    assert.match(error.cause.message, /ignored/);
    return true;
  });
});

test("stop supersedes activation that has not reached the hardware", async () => {
  const fixture = camera();
  await Promise.all([
    setCameraTorch(fixture.track, true),
    setCameraTorch(fixture.track, false),
  ]);
  assert.deepEqual(fixture.calls, []);
  assert.equal(fixture.settings.torch, false);
});

test("cleanup waits for in-flight activation, then leaves the torch off", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const fixture = camera({
    apply: async (enabled, settings) => {
      if (enabled) await gate;
      settings.torch = enabled;
    },
  });
  const activation = setCameraTorch(fixture.track, true);
  await Promise.resolve();
  assert.equal(fixture.calls.length, 1);
  const cleanup = setCameraTorch(fixture.track, false);
  assert.equal(fixture.calls.length, 1);
  release();
  await Promise.all([activation, cleanup]);
  assert.deepEqual(
    fixture.calls.map((entry) => entry.advanced.at(-1).torch),
    [true, false],
  );
  assert.equal(fixture.settings.torch, false);
});

test("a rejected activation does not prevent cleanup or affect a replacement track", async () => {
  const previous = camera({
    apply: async (enabled, settings) => {
      settings.torch = enabled;
      if (enabled) throw new Error("Device failed after applying torch");
    },
  });
  const replacement = camera();
  const activation = setCameraTorch(previous.track, true);
  await Promise.resolve();
  const cleanup = setCameraTorch(previous.track, false);
  const replacementActivation = setCameraTorch(replacement.track, true);
  await assert.rejects(activation, /turn the camera torch on/);
  await Promise.all([cleanup, replacementActivation]);
  assert.equal(previous.settings.torch, false);
  assert.equal(replacement.settings.torch, true);
});

test("ended tracks are released without attempting another hardware write", async () => {
  const fixture = camera();
  const activation = setCameraTorch(fixture.track, true);
  fixture.track.readyState = "ended";
  await activation;
  await setCameraTorch(fixture.track, false);
  assert.deepEqual(fixture.calls, []);
});

for (const failure of ["ignored", "rejected"]) {
  test(`${failure} torch shutdown releases its camera owner`, async () => {
    const fixture = camera({
      settingsTorch: true,
      apply: async () => {
        if (failure === "rejected") throw new Error("Torch is stuck on");
      },
    });
    const released = [];
    await assert.rejects(
      setCameraTorch(fixture.track, false, (track) => {
        released.push(track);
        track.stop();
      }),
      /turn the camera torch off/,
    );
    assert.deepEqual(released, [fixture.track]);
    assert.equal(fixture.track.readyState, "ended");
    assert.equal(fixture.settings.torch, false);
  });
}

test("failed torch shutdown stops the track when no owner callback is supplied", async () => {
  const fixture = camera({ settingsTorch: true, apply: async () => {} });
  await assert.rejects(setCameraTorch(fixture.track, false));
  assert.equal(fixture.track.readyState, "ended");
  assert.equal(fixture.settings.torch, false);
});

test("failed activation does not release the camera", async () => {
  const fixture = camera({ apply: async () => {} });
  const released = [];
  await assert.rejects(
    setCameraTorch(fixture.track, true, (track) => released.push(track)),
  );
  assert.deepEqual(released, []);
  assert.equal(fixture.track.readyState, "live");
});

for (const failure of ["ignored", "rejected"]) {
  test(`${failure} old shutdown cannot release a newly requested recording`, async () => {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const fixture = camera({
      settingsTorch: true,
      apply: async (enabled, settings) => {
        if (!enabled) {
          await gate;
          if (failure === "rejected") throw new Error("Torch is stuck on");
          return;
        }
        settings.torch = true;
      },
    });
    const released = [];
    const onShutdownFailure = (track) => {
      released.push(track);
      track.stop();
    };
    const shutdown = setCameraTorch(fixture.track, false, onShutdownFailure);
    await Promise.resolve();
    assert.equal(fixture.calls.length, 1);
    const nextRecording = setCameraTorch(
      fixture.track,
      true,
      onShutdownFailure,
    );
    release();
    await assert.rejects(shutdown, /turn the camera torch off/);
    await nextRecording;
    assert.deepEqual(released, []);
    assert.equal(fixture.track.readyState, "live");
    assert.equal(fixture.settings.torch, true);
  });
}

test("old track shutdown failure releases only that owner, leaving its replacement live", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const previous = camera({
    settingsTorch: true,
    apply: async () => {
      await gate;
      throw new Error("Old torch is stuck on");
    },
  });
  const replacement = camera();
  const released = [];
  const shutdown = setCameraTorch(previous.track, false, (track) => {
    released.push(track);
    track.stop();
  });
  await Promise.resolve();
  await setCameraTorch(replacement.track, true);
  release();
  await assert.rejects(shutdown, /turn the camera torch off/);
  assert.deepEqual(released, [previous.track]);
  assert.equal(previous.track.readyState, "ended");
  assert.equal(replacement.track.readyState, "live");
  assert.equal(replacement.settings.torch, true);
});
