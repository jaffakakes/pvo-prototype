export const TRACKING_MAX_SECONDS = 10;
export const TRACKING_FPS = 15;
export const TRACKING_MAX_FRAMES = 151;
export const TRACKING_MAX_EDGE = 640;
export const TRACKING_MAX_FRAME_BYTES = 160 * 1024;
export const TRACKING_MAX_REQUEST_BYTES = 20 * 1024 * 1024;

/** Scene-clock samples include both requested endpoints without stepping beyond a cut. */
export function objectTrackingTimes(start, end) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > 86400
    || end <= start || end - start > TRACKING_MAX_SECONDS)
    throw new Error("Track a range of up to ten seconds inside one video clip.");
  const count = Math.max(1, Math.ceil((end - start) * TRACKING_FPS - 0.000001));
  return Array.from({ length: count + 1 }, (_, index) => index === count ? end : start + index / TRACKING_FPS);
}

/** Provider boxes use canvas-normalized CENTRES; invisible frames carry no guessed geometry. */
export function parseObjectTrackingResult(value, { width, height, times }) {
  const invalid = () => new Error("Object tracking returned incomplete or invalid measurements.");
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some(key => !["model", "width", "height", "frames"].includes(key))
    || value.model !== "sam3.1" || value.width !== width || value.height !== height
    || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || Math.max(width, height) > TRACKING_MAX_EDGE || !Array.isArray(times) || !times.length
    || times.length > TRACKING_MAX_FRAMES || times.some((time, index) => !Number.isFinite(time) || time < 0 || time > 86400
      || (index > 0 && time <= times[index - 1])) || !Array.isArray(value.frames) || value.frames.length !== times.length)
    throw invalid();
  const frames = value.frames.map((frame, index) => {
    if (!frame || typeof frame !== "object" || Array.isArray(frame)
      || Object.keys(frame).some(key => !["time", "visible", "x", "y", "width", "height", "score"].includes(key))
      || !Number.isFinite(frame.time) || Math.abs(frame.time - times[index]) > 0.000001
      || typeof frame.visible !== "boolean"
      || ["x", "y", "width", "height", "score"].some(key => !Number.isFinite(frame[key]) || frame[key] < 0 || frame[key] > 1))
      throw invalid();
    if (!frame.visible && ["x", "y", "width", "height", "score"].some(key => frame[key] !== 0)) throw invalid();
    if (frame.visible && (frame.width <= 0 || frame.height <= 0
      || frame.x - frame.width / 2 < -0.000001 || frame.x + frame.width / 2 > 1.000001
      || frame.y - frame.height / 2 < -0.000001 || frame.y + frame.height / 2 > 1.000001)) throw invalid();
    return { time: times[index], visible: frame.visible, x: frame.x, y: frame.y,
      width: frame.width, height: frame.height, score: frame.score };
  });
  return { model: "sam3.1", width, height, frames };
}
