"""One SAM 3.1 session measures one object, with explicit loss and ambiguity."""
import io
import tempfile
import time
from pathlib import Path

import numpy as np
from PIL import Image

from request import TrackingError


def summarize_output(output):
    ids = np.asarray(output["out_obj_ids"]).tolist()
    masks = np.asarray(output["out_binary_masks"])
    scores = np.asarray(output.get("out_probs", [])).tolist()
    if len(ids) != len(scores) and ids:
        raise TrackingError("invalid_model_output", 502)
    boxes = {}
    for index, obj_id in enumerate(ids):
        mask = np.squeeze(masks[index])
        if mask.ndim != 2:
            raise TrackingError("invalid_model_output", 502)
        ys, xs = np.nonzero(mask)
        score = float(scores[index])
        if not len(xs) or not np.isfinite(score) or score < 0.5:
            continue
        height, width = mask.shape
        left, right = int(xs.min()), int(xs.max()) + 1
        top, bottom = int(ys.min()), int(ys.max()) + 1
        boxes[int(obj_id)] = {"visible": True,
            "x": (left + right) / (2 * width), "y": (top + bottom) / (2 * height),
            "width": (right - left) / width, "height": (bottom - top) / height,
            "score": min(1, max(0, score))}
    return boxes


def track(predictor, request, deadline_seconds=160):
    started = time.monotonic()
    target = request["target"]
    session_id = None
    outputs = {}
    identities = set()
    with tempfile.TemporaryDirectory(prefix="pvo-sam31-") as directory:
        for index, (_, data) in enumerate(request["frames"]):
            try:
                with Image.open(io.BytesIO(data)) as image:
                    if image.format != "JPEG" or image.size != (request["width"], request["height"]):
                        raise TrackingError("invalid_frame")
                    image.verify()
            except (OSError, Image.DecompressionBombError):
                raise TrackingError("invalid_frame") from None
            Path(directory, f"{index:05d}.jpg").write_bytes(data)
        try:
            session_id = predictor.handle_request({"type": "start_session", "resource_path": directory})["session_id"]
            prompt = {"type": "add_prompt", "session_id": session_id, "frame_index": 0}
            if target["kind"] == "text":
                prompt["text"] = target["text"].strip()
            else:
                prompt.update(points=[[target["x"], target["y"]]], point_labels=[1], obj_id=1)
            first = predictor.handle_request(prompt)

            def remember(response):
                if time.monotonic() - started > deadline_seconds:
                    raise TrackingError("tracking_timeout", 504)
                index = response["frame_index"]
                if not isinstance(index, int) or not 0 <= index < len(request["frames"]):
                    raise TrackingError("invalid_model_output", 502)
                measured = summarize_output(response["outputs"])
                identities.update(measured)
                if len(identities) > 1:
                    raise TrackingError("ambiguous_target")
                outputs[index] = measured

            remember(first)
            for response in predictor.handle_stream_request({"type": "propagate_in_video",
                    "session_id": session_id, "propagation_direction": "forward", "start_frame_index": 0}):
                remember(response)
            if not identities:
                raise TrackingError("target_not_found")
            obj_id = next(iter(identities))
            missing = {"visible": False, "x": 0, "y": 0, "width": 0, "height": 0, "score": 0}
            return {"model": "sam3.1", "width": request["width"], "height": request["height"],
                "frames": [{"time": stamp, **outputs.get(index, {}).get(obj_id, missing)}
                    for index, (stamp, _) in enumerate(request["frames"])]}
        finally:
            if session_id is not None:
                predictor.handle_request({"type": "close_session", "session_id": session_id})
