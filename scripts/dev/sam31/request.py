"""The bounded, data-only input contract for the SAM 3.1 development service."""
import base64
import math

MAX_BYTES = 20 * 1024 * 1024


class TrackingError(Exception):
    def __init__(self, code, status=422):
        super().__init__(code)
        self.code = code
        self.status = status


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def validate_request(body):
    if not isinstance(body, dict):
        raise TrackingError("invalid_request")
    width, height = body.get("width"), body.get("height")
    if any(not isinstance(v, int) or isinstance(v, bool) or v < 1 or v > 640 for v in (width, height)):
        raise TrackingError("invalid_dimensions")
    start, end = body.get("start"), body.get("end")
    if not number(start) or not number(end) or start < 0 or end > 86400 or end <= start or end - start > 10.000001:
        raise TrackingError("invalid_range")
    target = body.get("target")
    if not isinstance(target, dict):
        raise TrackingError("invalid_target")
    if target.get("kind") == "text":
        text = target.get("text")
        if not isinstance(text, str) or not text.strip() or len(text) > 200:
            raise TrackingError("invalid_target")
    elif target.get("kind") == "point":
        if any(not number(target.get(k)) or not 0 <= target[k] <= 1 for k in ("x", "y")):
            raise TrackingError("invalid_target")
    else:
        raise TrackingError("invalid_target")
    frames = body.get("frames")
    expected_count = math.ceil((end - start) * 15 - 0.000001) + 1
    if not isinstance(frames, list) or len(frames) != expected_count or not 2 <= len(frames) <= 151:
        raise TrackingError("invalid_frame_count")
    decoded = []
    for index, frame in enumerate(frames):
        expected_time = end if index == len(frames) - 1 else start + index / 15
        if not isinstance(frame, dict) or not number(frame.get("time")) or abs(frame["time"] - expected_time) > 0.00001:
            raise TrackingError("invalid_frame_time")
        image = frame.get("imageDataUrl")
        prefix = "data:image/jpeg;base64,"
        if not isinstance(image, str) or not image.startswith(prefix) or len(image) > 220000:
            raise TrackingError("invalid_frame")
        try:
            data = base64.b64decode(image[len(prefix):], validate=True)
        except (ValueError, TypeError):
            raise TrackingError("invalid_frame") from None
        if not 1 <= len(data) <= 160 * 1024:
            raise TrackingError("invalid_frame")
        decoded.append((frame["time"], data))
    return {"width": width, "height": height, "target": target, "frames": decoded}
