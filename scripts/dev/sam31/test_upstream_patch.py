"""CPU regressions for the narrowly pinned SAM output merger patch."""
import ast
import tempfile
import unittest
from pathlib import Path

from patch_upstream import POINT_OUTPUT_AFTER, POINT_OUTPUT_BEFORE, replace_verified

# Pinned upstream method: this must model its real cache/refinement behavior.
UPSTREAM_METHOD = '''class Tracking:
    def _build_sam2_output(self, inference_state, frame_idx, refined_obj_id_to_mask=None):
        if not frame_idx in inference_state["cached_frame_outputs"]:
            return {}

        cached_outputs = inference_state["cached_frame_outputs"][frame_idx]
        obj_id_to_mask = cached_outputs.copy()

        if refined_obj_id_to_mask is not None:
            for obj_id, refined_mask in refined_obj_id_to_mask.items():
                assert refined_mask is not None
                obj_id_to_mask[obj_id] = refined_mask
        return obj_id_to_mask
'''


def load_merger(source):
    namespace = {}
    exec(compile(ast.parse(source), "sam-point-output", "exec"), namespace)
    return namespace["Tracking"]()._build_sam2_output


class PointOutputPatchTests(unittest.TestCase):
    def test_new_point_masks_survive_without_a_grounding_cache(self):
        state = {"cached_frame_outputs": {}}
        measured_mask = object()
        self.assertEqual(load_merger(UPSTREAM_METHOD)(state, 1, {1: measured_mask}), {})
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "sam3_multiplex_tracking.py"
            source.write_text(UPSTREAM_METHOD)
            replace_verified(source, POINT_OUTPUT_BEFORE, POINT_OUTPUT_AFTER)
            fixed = load_merger(source.read_text())
            self.assertIs(fixed(state, 1, {1: measured_mask})[1], measured_mask)
            self.assertEqual(fixed(state, 2), {})
            self.assertEqual(state, {"cached_frame_outputs": {}})
            original_mask, refined_mask = object(), object()
            state["cached_frame_outputs"][0] = {1: original_mask, 2: original_mask}
            result = fixed(state, 0, {1: refined_mask})
            self.assertIs(result[1], refined_mask)
            self.assertIs(result[2], original_mask)
            self.assertIs(state["cached_frame_outputs"][0][1], original_mask)

    def test_patch_is_idempotent_and_rejects_changed_upstream(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "sam3_multiplex_tracking.py"
            source.write_text(UPSTREAM_METHOD)
            replace_verified(source, POINT_OUTPUT_BEFORE, POINT_OUTPUT_AFTER)
            once = source.read_text()
            replace_verified(source, POINT_OUTPUT_BEFORE, POINT_OUTPUT_AFTER)
            self.assertEqual(source.read_text(), once)
            source.write_text("unrecognized upstream contract")
            with self.assertRaisesRegex(RuntimeError, "differs from pinned API"):
                replace_verified(source, POINT_OUTPUT_BEFORE, POINT_OUTPUT_AFTER)


if __name__ == "__main__":
    unittest.main()
