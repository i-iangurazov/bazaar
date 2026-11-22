"""Private, packed gallery endpoint. Native inference stages run one at a time."""
import argparse
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
import os
from pathlib import Path
import select
import signal
import subprocess
import sys
import threading
import time

from compact_weights import verify_compact_weights
from geometry import valid_region
from pipeline import select_views
from readiness import worker_ready
from stream_protocol import (BLOCK_ROWS, DIMENSION, MAX_HEADER_BYTES, MAX_VECTORS, PROTOCOL, RECORD_BYTES,
                             pack_header, read_exact, read_header, valid_count)

HERE = Path(__file__).resolve().parent
MODEL_VERSION = 'ppshitu-v2-pplcnetv2-v1-fp32-224'


def remaining(deadline):
    seconds = deadline - time.monotonic()
    if seconds <= 0:
        raise TimeoutError('deadlineExceeded')
    return seconds


class RequestBody:
    def __init__(self, handler, deadline):
        self.handler = handler
        self.deadline = deadline

    def read(self, size):
        data = bytearray()
        while len(data) < size:
            self.handler.connection.settimeout(min(8, remaining(self.deadline)))
            block = self.handler.rfile.read1(min(64 * 1024, size - len(data)))
            if not block:
                break
            data.extend(block)
        return data


def child_environment(threads):
    # HTTP tokens and DB credentials belong to their consumers only.
    return {'PATH': os.environ.get('PATH', os.defpath), 'HOME': '/tmp',
            'OMP_NUM_THREADS': str(threads), 'OPENBLAS_NUM_THREADS': str(threads),
            'MALLOC_ARENA_MAX': '2', 'PYTHONDONTWRITEBYTECODE': '1'}


def write_pipe(pipe, data, deadline):
    pending = memoryview(data)
    while pending:
        _, writable, _ = select.select([], [pipe], [], remaining(deadline))
        if not writable:
            raise TimeoutError('rankWriteTimeout')
        try:
            pending = pending[os.write(pipe.fileno(), pending):]
        except BlockingIOError:
            continue


def decode_result(output):
    if len(output) > 64 * 1024:
        raise RuntimeError('invalidStageOutput')
    result = json.loads(output)
    if result.get('error') == 'invalidInput':
        raise ValueError('invalidStageInput')
    return result


def rank_gallery(reader, count, queries, threads, deadline):
    """Discard partial galleries on every timeout, failed frame, or child exit."""
    with subprocess.Popen([sys.executable, str(HERE / 'stream_rank.py'), str(threads)], stdin=subprocess.PIPE,
                          stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                          env=child_environment(threads)) as process:
        try:
            os.set_blocking(process.stdin.fileno(), False)
            write_pipe(process.stdin, pack_header({'count': count, 'queries': queries}), deadline)
            for offset in range(0, count, BLOCK_ROWS):
                block = min(count - offset, BLOCK_ROWS)
                write_pipe(process.stdin, read_exact(reader, block * RECORD_BYTES), deadline)
            process.stdin.close()
            process.stdin = None
            output, _ = process.communicate(timeout=remaining(deadline))
            if process.returncode:
                raise RuntimeError('rankingFailed')
            return decode_result(output)['batches']
        finally:
            if process.poll() is None:
                process.kill()


def inference(args, action, body, deadline):
    result = subprocess.run([sys.executable, str(HERE / 'compact_stage.py'), action, '--model-dir', str(args.model_dir),
                             '--vision-model-dir', str(args.vision_model_dir), '--threads', str(args.threads)],
                            input=json.dumps(body).encode(), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                            timeout=remaining(deadline), env=child_environment(args.threads), check=False)
    if result.returncode:
        raise RuntimeError('inferenceFailed')
    return decode_result(result.stdout)


def serve(args, token):
    available = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(8)

        def log_message(self, *_):
            pass  # No data, secrets or payloads in request logs.

        def reply(self, status, result):
            payload = json.dumps(result, separators=(',', ':')).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(payload)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Connection', 'close')
            if status == 429:
                self.send_header('Retry-After', '2')
            self.end_headers()
            try:
                self.wfile.write(payload)
            except (BrokenPipeError, ConnectionResetError, TimeoutError):
                pass

        def authorized(self):
            return hmac.compare_digest(self.headers.get('Authorization', '').encode(), f'Bearer {token}'.encode())

        def do_GET(self):
            if self.path == '/ready':
                ready = worker_ready()
                return self.reply(200 if ready else 503, {'ready': ready})
            if not self.authorized():
                return self.reply(401, {'error': 'unauthorized'})
            if self.path != '/health':
                return self.reply(404, {'error': 'notFound'})
            self.reply(200, {'ready': worker_ready(), 'vision': True, 'modelVersion': MODEL_VERSION,
                             'dimension': DIMENSION, 'galleryProtocol': PROTOCOL, 'maxImages': MAX_VECTORS})

        def do_POST(self):
            if not self.authorized():
                return self.reply(401, {'error': 'unauthorized'})
            if self.path not in ('/embed', '/search-stream'):
                return self.reply(404, {'error': 'notFound'})
            if not available.acquire(blocking=False):
                return self.reply(429, {'error': 'busy'})
            try:
                if self.headers.get('Transfer-Encoding') or len(self.headers.get_all('Content-Length', [])) != 1:
                    raise ValueError('invalidLength')
                length = int(self.headers['Content-Length'])
                kind = self.headers.get('Content-Type', '').split(';', 1)[0].strip().lower()
                deadline = time.monotonic() + 43
                reader = RequestBody(self, deadline)
                if self.path == '/embed':
                    if kind != 'application/json' or not 0 < length <= MAX_HEADER_BYTES:
                        raise ValueError('invalidRequest')
                    body = json.loads(read_exact(reader, length))
                    result = inference(args, 'embed', {'imageBase64': body['imageBase64']}, deadline)
                else:
                    if kind != 'application/octet-stream' or not 4 < length <= 4 + MAX_HEADER_BYTES + MAX_VECTORS * RECORD_BYTES:
                        raise ValueError('invalidRequest')
                    result = self.find(reader, length, deadline)
                self.reply(200, {'modelVersion': MODEL_VERSION, **result})
            except (ValueError, TypeError, KeyError, BrokenPipeError, ConnectionResetError):
                self.reply(400, {'error': 'invalidInput'})
            except (TimeoutError, subprocess.TimeoutExpired):
                self.reply(504, {'error': 'timeout'})
            except Exception:
                self.reply(503, {'error': 'unavailable'})
            finally:
                available.release()

        def find(self, reader, length, deadline):
            header, header_size = read_header(reader)
            count = header.get('count')
            if not valid_count(count) or length != header_size + count * RECORD_BYTES:
                raise ValueError('invalidLength')
            region, automatic, threshold = header.get('region'), header.get('autoRegion', True), header.get('minScore', 0.68)
            if (region is not None and not valid_region(region)) or type(automatic) is not bool:
                raise ValueError('invalidRegion')
            if type(threshold) not in (float, int) or not math.isfinite(threshold) or not 0 <= threshold <= 1:
                raise ValueError('invalidThreshold')
            image = {'imageBase64': header['imageBase64']}
            descriptions = inference(args, 'describe', {**image, 'region': region, 'autoRegion': automatic}, deadline)
            batches = rank_gallery(reader, count, descriptions['queries'], args.threads, deadline)
            matches, box, source = select_views(descriptions['regions'], batches, region, threshold)
            result = inference(args, 'ocr', {**image, 'region': box, 'source': source}, deadline)
            return {'matches': matches, 'analysis': result['analysis']}

    with ThreadingHTTPServer((args.host, args.port), Handler) as server:
        server.daemon_threads = True
        signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(SystemExit(0)))
        print(f'Compact PP-ShiTu ready on {args.host}:{args.port}', flush=True)
        server.serve_forever()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model-dir', type=Path, required=True)
    parser.add_argument('--vision-model-dir', type=Path, required=True)
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=3150)
    parser.add_argument('--threads', type=int, choices=[1, 2, 4], default=1)
    args = parser.parse_args()
    token = os.environ.get('PRODUCT_PHOTO_SEARCH_TOKEN', '')
    if len(token) < 32:
        parser.error('Set a private service token of at least 32 characters')
    verify_compact_weights(args.model_dir)
    # Check the OCR source hashes before accepting requests, without importing OpenCV.
    import hashlib
    registry = json.loads((HERE / 'vision-models.json').read_text())
    for name, digest in registry['files'].items():
        if name.startswith('ocr/'):
            with (args.vision_model_dir / name).open('rb') as stream:
                if hashlib.file_digest(stream, 'sha256').hexdigest() != digest:
                    raise ValueError('unexpectedVisionWeights')
    serve(args, token)


if __name__ == '__main__':
    main()
