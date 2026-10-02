"""Authenticated development adapter. No URL fetching, code execution or public jobs."""
import argparse
import hmac
import json
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import torch

from inference import track
from request import MAX_BYTES, TrackingError, validate_request


def serve(predictor, token, port):
    busy = threading.BoundedSemaphore(1)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def send_json(self, status, value):
            data = json.dumps(value, allow_nan=False).encode()
            try:
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(data)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def authorized(self):
            return hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + token)

        def do_GET(self):
            if not self.authorized():
                return self.send_json(401, {"code": "unauthorized"})
            if self.path != "/health":
                return self.send_json(404, {"code": "not_found"})
            self.send_json(200, {"ready": True, "model": "sam3.1"})

        def do_POST(self):
            if not self.authorized():
                return self.send_json(401, {"code": "unauthorized"})
            if self.path != "/track":
                return self.send_json(404, {"code": "not_found"})
            if not busy.acquire(blocking=False):
                return self.send_json(409, {"code": "tracking_busy"})
            started = time.monotonic()
            try:
                if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
                    raise TrackingError("invalid_content_type", 415)
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= MAX_BYTES:
                    raise TrackingError("request_too_large", 413)
                self.connection.settimeout(30)
                body = validate_request(json.loads(self.rfile.read(length)))
                # Autocast is thread-local: the HTTP worker needs its own context.
                with torch.inference_mode(), torch.autocast("cuda", dtype=torch.bfloat16):
                    result = track(predictor, body)
                print(json.dumps({"event": "tracking_complete", "frames": len(result["frames"]),
                    "visible": sum(frame["visible"] for frame in result["frames"]),
                    "seconds": round(time.monotonic() - started, 3)}), flush=True)
                self.send_json(200, result)
            except TrackingError as error:
                self.send_json(error.status, {"code": error.code})
            except (ValueError, UnicodeError, TimeoutError):
                self.send_json(400, {"code": "invalid_request"})
            except Exception:
                traceback.print_exc()
                self.send_json(500, {"code": "tracking_failed"})
            finally:
                busy.release()

    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(json.dumps({"event": "ready", "model": "sam3.1", "port": port}), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--token-file", required=True)
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    token = Path(args.token_file).read_text().strip()
    if len(token) < 32:
        raise SystemExit("A service token of at least 32 characters is required.")
    from sam3.model_builder import build_sam3_multiplex_video_predictor
    predictor = build_sam3_multiplex_video_predictor(checkpoint_path=args.checkpoint,
        use_fa3=False, compile=False, warm_up=False, async_loading_frames=False)
    serve(predictor, token, args.port)
