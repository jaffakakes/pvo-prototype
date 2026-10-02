"""Repair verified session and point-output bugs in the pinned SAM 3.1 checkout."""
import sys
from pathlib import Path

SESSION_BEFORE = "            offload_state_to_cpu=offload_state_to_cpu,\n"
SESSION_AFTER = "            # PVO SAM3.1: multiplex init_state has no offload_state_to_cpu argument.\n"

POINT_OUTPUT_BEFORE = '''        if not frame_idx in inference_state["cached_frame_outputs"]:
            return {}

        cached_outputs = inference_state["cached_frame_outputs"][frame_idx]
        obj_id_to_mask = cached_outputs.copy()
'''
POINT_OUTPUT_AFTER = '''        # PVO SAM3.1: a new point-only track has no prior grounding cache.
        # Keep its measured masks on newly visited frames as well as refinements.
        obj_id_to_mask = inference_state["cached_frame_outputs"].get(frame_idx, {}).copy()
'''


def replace_verified(source, before, after):
    text = source.read_text()
    if after in text:
        return
    if text.count(before) != 1:
        raise RuntimeError(f"SAM source differs from pinned API in {source.name}; review before patching.")
    source.write_text(text.replace(before, after))


def patch_checkout(root):
    replace_verified(root / "sam3/model/sam3_base_predictor.py", SESSION_BEFORE, SESSION_AFTER)
    replace_verified(root / "sam3/model/sam3_multiplex_tracking.py", POINT_OUTPUT_BEFORE, POINT_OUTPUT_AFTER)


if __name__ == "__main__":
    patch_checkout(Path(sys.argv[1]))
    print("SAM 3.1 session and point-output patches verified")
