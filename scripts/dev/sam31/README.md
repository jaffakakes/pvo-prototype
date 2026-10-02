# SAM 3.1 development service

This GPU adapter measures one selected object in frames supplied by the editor.
It accepts text or a point prompt and returns measured bounding-box centres, sizes
and explicit missing detections. It never edits projects; the editor validates
observations and converts them through its shared, undoable animation commands.
See [layer animation](../../../docs/engineering/layer-animation.md).

## Model and runtime

Use the official [SAM repository](https://github.com/facebookresearch/sam3) at
`2345a4ad109ac29c569da749c91d84f10dc08c40` and the authorized checkpoint from
[`facebook/sam3.1`](https://huggingface.co/facebook/sam3.1). The tested file is
`sam3.1_multiplex.pt`, 3,502,755,717 bytes, with SHA-256
`0567debeec80ba4ac6369540c6c248025283cb3ff2b92827509e57e2b3541cb6`.
Model access and license acceptance belong to the user's Hugging Face account.

The development test uses one NVIDIA L40S with 48 GB VRAM, Python 3.12 and the
direct dependency versions in [requirements.txt](requirements.txt). The running
Torch build reports `2.14.1+cu130`; the original container's Torch 2.8 is superseded
inside the isolated environment. This is a tested development runtime, not a
published production container or a claim that all smaller GPUs are supported.

Example setup inside the GPU machine, with `uv` installed:

```sh
git clone https://github.com/facebookresearch/sam3 /workspace/pvo-sam31/vendor-sam3
git -C /workspace/pvo-sam31/vendor-sam3 checkout 2345a4ad109ac29c569da749c91d84f10dc08c40
uv venv --python 3.12 /workspace/pvo-sam31/env
uv pip install --python /workspace/pvo-sam31/env/bin/python -r requirements.txt -e /workspace/pvo-sam31/vendor-sam3
python3 patch_upstream.py /workspace/pvo-sam31/vendor-sam3
```

Keep the clone's directory name `vendor-sam3`: naming a sibling directory `sam3`
can shadow the installed Python package. `patch_upstream.py` applies only reviewed
fixes against the pinned source and rejects unexpected source shapes: remove an
unsupported session argument, and preserve measured point-track masks on frames
without an existing text-detection cache. The latter fixes first-frame-only output
from fresh point sessions; it does not invent or interpolate model detections. Checkpoint
loading first targets an intermediate tracker and then the assembled model; the
final assembled-model diagnostics determine which weights remain missing.

Download the checkpoint using an authorized Hugging Face session. Verify its hash
before starting the service. Use a private download credential file or an
interactive login; do not put the token in command arguments, source control or
browser code. A temporary GPU download credential can be removed after download.
The serving process does not need that credential.

## Serving and website configuration

Create a random service token of at least 32 characters, write it to a private
file with mode `0600`, then run from this service directory:

```sh
/workspace/pvo-sam31/env/bin/python server.py --checkpoint /workspace/pvo-sam31/models/sam3.1_multiplex.pt --token-file /workspace/pvo-sam31/service-token
```

The adapter binds port 8000 and requires the service token for both `GET /health`
and `POST /track`. Publish that port over HTTPS through the configured Runpod
proxy. The Worker needs these private environment entries:

```env
SAM_TRACKING_URL=https://YOUR_POD_ID-8000.proxy.runpod.net/track
SAM_TRACKING_TOKEN=<same private service token>
```

Keep these in ignored server configuration. This is a service credential, not a
Runpod account API key. The browser never receives it. The Worker restricts the
destination to the supported HTTPS Runpod proxy, or the explicitly enabled local
development address `http://127.0.0.1:5199/track`. Restart the local Worker after
changing private environment values. `/api/assistant/status` then reports whether
object tracking is configured; it does not prove the GPU service is healthy.

The GPU pod remains billable while running, including between requests. The
L40S selected for the October 2 development test was quoted at $1.09/hour before
storage; that is a test-time quote, not a fixed platform price. Stopping or deleting
the pod makes tracking unavailable. Do not delete a pod with the only copy of
important data. A production deployment still needs a reproducible image,
resource lifecycle and concurrency appropriate to its traffic.

## Contract and lifecycle

`POST /track` accepts JSON:

```json
{
  "sceneId": "scene-1", "clipId": 1, "start": 0, "end": 1,
  "target": {"kind": "point", "x": 0.5, "y": 0.5},
  "width": 360, "height": 640,
  "frames": [{"time": 0, "imageDataUrl": "data:image/jpeg;base64,..."}]
}
```

The abbreviated example omits the remaining frames. A full request must include
both endpoints and every 15 fps sample, at most 151 frames over ten seconds. Text
targets use `{"kind":"text","text":"red car"}` with at most 200 characters.
Dimensions are at most 640 pixels on either edge, each JPEG at most 160 KiB and
the complete body at most 20 MiB. Point coordinates refer to the complete supplied
canvas, not uncropped source pixels. The adapter does not fetch arbitrary URLs.

The response is `{"model":"sam3.1","width":360,"height":640,"frames":[...]}`.
Each frame has `time`, `visible`, centre `x/y`, `width/height`, and model `score`.
Geometry is normalized to the canvas. `score` is SAM's exported object score; for
point-selected objects its upstream seed score remains 1.0, so it is not a
calibrated per-frame confidence probability. Missing detections have `visible:false` and
zero geometry/score; no box is guessed. Text matching more than one identity
returns `422 ambiguous_target`; no matching identity returns `target_not_found`.
The downstream editor also refuses to apply fewer than two confident samples.

The process owns one GPU job at a time (`409` while busy). Each request gets its
own SAM session and temporary frame directory, released in `finally`. It checks
a 160-second inference deadline between model outputs; this is not a hard kill
of a stuck CUDA kernel. A disconnected browser cannot commit edits, but the
already-running GPU job may finish. Request frames and tokens are not logged.
The service logs completion counts/timing and internal failure traces.

## Verification

Run `env/bin/python -m unittest test_service test_upstream_patch` from this
directory with the GPU environment.
These adapter tests use explicit fake masks to check validation, loss, ambiguity
and cleanup. They do not establish model accuracy. Editor `tracking-capture` and
`object-tracking-controls` browser suites test real decoding and UI lifecycles
with deterministic provider measurements. Separate live tests must check actual
text/point model results, identity retention, loss, application and Undo.

Sampling at 15 fps estimates object motion; it is not exact motion capture.
Occlusion, small objects, scene cuts and ambiguous prompts still need review.
Manual keyframes remain editable after tracking.
