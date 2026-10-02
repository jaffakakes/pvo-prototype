"""Adapter regressions; these use explicit fake masks, not model quality evidence."""
import base64
import io
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

from inference import summarize_output, track
from request import TrackingError, validate_request


def payload(duration=0.1):
    image = io.BytesIO()
    Image.new("RGB", (32, 16), "red").save(image, "JPEG")
    data = "data:image/jpeg;base64," + base64.b64encode(image.getvalue()).decode()
    return {"width": 32, "height": 16, "start": 0, "end": duration,
        "target": {"kind": "point", "x": 0.5, "y": 0.5},
        "frames": [{"time": time, "imageDataUrl": data} for time in [0, 1 / 15, duration]]}


def output(ids=(1,)):
    masks = np.zeros((len(ids), 16, 32), dtype=bool)
    masks[:, 4:12, 8:24] = True
    return {"out_obj_ids": np.array(ids), "out_binary_masks": masks,
        "out_probs": np.ones(len(ids)) * 0.9}


class Predictor:
    def __init__(self, frames):
        self.frames = frames
        self.closed = False
        self.directory = None

    def handle_request(self, request):
        if request["type"] == "start_session":
            self.directory = request["resource_path"]
            assert len(list(Path(self.directory).glob("*.jpg"))) == 3
            return {"session_id": "test"}
        if request["type"] == "close_session":
            self.closed = True
            return {}
        return {"frame_index": 0, "outputs": self.frames[0]}

    def handle_stream_request(self, _request):
        for index, item in enumerate(self.frames):
            yield {"frame_index": index, "outputs": item}


class ServiceTests(unittest.TestCase):
    def test_non_integer_duration_keeps_fifteen_fps_and_exact_endpoint(self):
        request = validate_request(payload())
        self.assertEqual([frame[0] for frame in request["frames"]], [0, 1 / 15, 0.1])

    def test_invalid_time_or_geometry_is_rejected(self):
        body = payload()
        body["frames"][1]["time"] = 0.05
        with self.assertRaisesRegex(TrackingError, "invalid_frame_time"):
            validate_request(body)
        body = payload()
        body["target"]["x"] = float("nan")
        with self.assertRaisesRegex(TrackingError, "invalid_target"):
            validate_request(body)

    def test_text_target_matches_the_two_hundred_character_adapter_contract(self):
        body = payload()
        body["target"] = {"kind": "text", "text": "x" * 200}
        self.assertEqual(validate_request(body)["target"]["text"], "x" * 200)
        body["target"]["text"] += "x"
        with self.assertRaisesRegex(TrackingError, "invalid_target"):
            validate_request(body)

    def test_loss_is_explicit_and_sessions_and_frames_are_released(self):
        predictor = Predictor([output(), output(()), output()])
        result = track(predictor, validate_request(payload()))
        self.assertEqual(result["frames"][0]["x"], 0.5)
        self.assertEqual(result["frames"][0]["width"], 0.5)
        self.assertEqual(result["frames"][1], {"time": 1 / 15, "visible": False,
            "x": 0, "y": 0, "width": 0, "height": 0, "score": 0})
        self.assertTrue(predictor.closed)
        self.assertFalse(Path(predictor.directory).exists())

    def test_ambiguous_target_is_not_silently_chosen(self):
        predictor = Predictor([output((1, 2))])
        with self.assertRaisesRegex(TrackingError, "ambiguous_target"):
            track(predictor, validate_request(payload()))
        self.assertTrue(predictor.closed)
        self.assertFalse(Path(predictor.directory).exists())

    def test_missing_target_is_not_an_empty_success(self):
        predictor = Predictor([output(())] * 3)
        with self.assertRaisesRegex(TrackingError, "target_not_found"):
            track(predictor, validate_request(payload()))
        self.assertTrue(predictor.closed)

    def test_scores_are_measured_not_fabricated(self):
        values = output()
        del values["out_probs"]
        with self.assertRaisesRegex(TrackingError, "invalid_model_output"):
            summarize_output(values)


if __name__ == "__main__":
    unittest.main()
