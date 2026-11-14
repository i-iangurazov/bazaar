"""Private CPU service. Public access, tenant authorization and file intake stay in Bazaar."""
import argparse
import base64
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
import os
from pathlib import Path
import signal
import threading

# Apply before importing native runtimes. No downloads or fallback providers.
os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "2")
from engine import Encoder, MODEL_VERSION, DIMENSION
import cv2
import numpy as np
from retrieval import Searcher
from vision import Vision, valid_region
from pipeline import search_views


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--port", type=int, default=3150)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--threads", type=int, choices=[1, 2, 4], default=2)
    parser.add_argument("--vision-model-dir", type=Path, help="Optional pinned detector/OCR assets, prepared offline")
    args = parser.parse_args()
    token = os.environ.get("PRODUCT_PHOTO_SEARCH_TOKEN", "")
    if len(token) < 32:
        raise SystemExit("PRODUCT_PHOTO_SEARCH_TOKEN must have at least 32 characters")
    encoder = Encoder(args.model_dir, args.threads)
    encoder.encode(cv2.imencode(".jpg", np.zeros((224, 224, 3), dtype="uint8"))[1].tobytes())
    vision = Vision(args.vision_model_dir, args.threads) if args.vision_model_dir else None
    searcher = Searcher(args.threads)
    capacity = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(10)

        def log_message(self, *_):
            pass  # No images, features, request payloads or credentials in logs.

        def reply(self, status, value):
            body = json.dumps(value, separators=(",", ":")).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")
            if status == 429:
                self.send_header("Retry-After", "2")
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def authorized(self):
            return hmac.compare_digest(self.headers.get("Authorization", ""), f"Bearer {token}")

        def do_GET(self):
            if not self.authorized():
                return self.reply(401, {"error": "unauthorized"})
            if self.path != "/health":
                return self.reply(404, {"error": "notFound"})
            self.reply(200, {"modelVersion": MODEL_VERSION, "dimension": DIMENSION, "ready": searcher.process.poll() is None, "vision": vision is not None})

        def do_POST(self):
            if not self.authorized():
                return self.reply(401, {"error": "unauthorized"})
            if self.path not in ["/embed", "/search"]:
                return self.reply(404, {"error": "notFound"})
            if not capacity.acquire(blocking=False):
                return self.reply(429, {"error": "busy"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 32*1024*1024 or not self.headers.get("Content-Type", "").startswith("application/json"):
                    return self.reply(400, {"error": "invalidInput"})
                raw = self.rfile.read(length)
                if len(raw) != length:
                    return self.reply(400, {"error": "invalidInput"})
                request = json.loads(raw)
                data = base64.b64decode(request["imageBase64"], validate=True)
                if not 0 < len(data) <= 3*1024*1024:
                    return self.reply(400, {"error": "invalidImage"})
                if self.path == '/embed':
                    result = {'embedding': encoder.encode(data).tolist()}
                else:
                    region = request.get('region')
                    if region is not None and not valid_region(region):
                        raise ValueError('invalidRegion')
                    automatic = request.get('autoRegion', True)
                    if not isinstance(automatic, bool):
                        raise ValueError('invalidRegion')
                    min_score = request.get('minScore', 0.68)
                    if type(min_score) not in (int, float) or not math.isfinite(min_score) or not 0 <= min_score <= 1:
                        raise ValueError('invalidThreshold')
                    rgb = encoder.decode(data)
                    result = search_views(rgb, encoder, searcher, request['vectorsBase64'], request['groups'], vision, region, automatic, min_score)
                self.reply(200, {"modelVersion": MODEL_VERSION, **result})
            except (ValueError, KeyError, TypeError, TimeoutError):
                self.reply(400, {"error": "invalidInput"})
            except Exception:
                self.reply(503, {"error": "unavailable"})
            finally:
                capacity.release()

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    server.daemon_threads = True
    signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(SystemExit(0)))
    print(f"PP-ShiTu ready on {args.host}:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        searcher.close()


if __name__ == "__main__":
    main()
