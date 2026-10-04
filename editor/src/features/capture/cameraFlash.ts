type Facing = "user" | "environment";
type FlashMode = "screen" | "torch" | null;
type TorchCapabilities = MediaTrackCapabilities & {
  torch?: boolean | boolean[];
};
type TorchConstraintSet = MediaTrackConstraintSet & {
  torch?: ConstrainBoolean;
};
type TorchConstraints = MediaTrackConstraints & {
  torch?: ConstrainBoolean;
};
type TorchUpdates = { tail: Promise<void>; revision: number };

const torchUpdates = new WeakMap<MediaStreamTrack, TorchUpdates>();

export function cameraFlashMode(
  track: MediaStreamTrack | null,
  requestedFacing: Facing,
): FlashMode {
  if (!track || track.readyState !== "live") return null;
  try {
    const settings = track.getSettings();
    const facing = settings.facingMode || requestedFacing;
    if (facing === "user") return "screen";
    const capabilities = track.getCapabilities?.() as
      TorchCapabilities | undefined;
    const torch = capabilities?.torch;
    // Chromium exposes a boolean; the specification uses supported values.
    const controllable =
      torch === true ||
      (Array.isArray(torch) && torch.includes(true) && torch.includes(false));
    return controllable && typeof settings.torch === "boolean" ? "torch" : null;
  } catch {
    return null;
  }
}

function torchConstraints(
  track: MediaStreamTrack,
  enabled: boolean,
): MediaTrackConstraints {
  const {
    torch: _previousTorch,
    advanced = [],
    ...base
  } = track.getConstraints() as TorchConstraints;
  const preserved = advanced
    .map((entry: TorchConstraintSet) => {
      const { torch: _previousTorch, ...other } = entry;
      return other;
    })
    .filter((entry) => Object.keys(entry).length > 0);
  // applyConstraints replaces existing constraints, including camera quality
  // and zoom. Preserve those while replacing every previous torch request.
  return {
    ...base,
    advanced: [...preserved, { torch: enabled } as TorchConstraintSet],
  };
}

/** Latest queued intent wins; an in-flight activation still finishes before off. */
export function setCameraTorch(
  track: MediaStreamTrack,
  enabled: boolean,
  onShutdownFailure?: (track: MediaStreamTrack) => void,
): Promise<void> {
  let updates = torchUpdates.get(track);
  if (!updates) {
    updates = { tail: Promise.resolve(), revision: 0 };
    torchUpdates.set(track, updates);
  }
  const queue = updates;
  const revision = ++queue.revision;
  const update = queue.tail.then(async () => {
    if (revision !== queue.revision || track.readyState !== "live") return;
    try {
      if (track.getSettings().torch === enabled) return;
      await track.applyConstraints(torchConstraints(track, enabled));
      if (
        track.readyState === "live" &&
        track.getSettings().torch !== enabled
      ) {
        throw new Error("The camera ignored the requested torch setting.");
      }
    } catch (cause) {
      if (
        !enabled &&
        revision === queue.revision &&
        track.readyState === "live"
      ) {
        // A live torch cannot be left on after recording ends. Release its
        // owner only if a newer recording has not superseded this off request.
        if (onShutdownFailure) onShutdownFailure(track);
        else track.stop();
      }
      throw new Error(
        `Could not turn the camera torch ${enabled ? "on" : "off"}.`,
        {
          cause,
        },
      );
    }
  });
  // Keep cleanup runnable after rejection; the caller still receives the error.
  queue.tail = update.catch(() => {});
  return update;
}
