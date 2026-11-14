"""Private socketpair Faiss executor: isolates its OpenMP runtime from ML frameworks."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import socket
import struct
import subprocess
import sys
import time


def receive(connection):
    def exact(size):
        parts = bytearray()
        while len(parts) < size:
            value = connection.recv(size-len(parts))
            if not value:
                raise EOFError("retrieval executor disconnected")
            parts.extend(value)
        return parts

    size = struct.unpack("!I", exact(4))[0]
    if size > 8 * 1024 * 1024:
        raise ValueError("retrieval message too large")
    return json.loads(exact(size))


def send(connection, value):
    data = json.dumps(value, separators=(",", ":")).encode()
    if len(data) > 8 * 1024 * 1024:
        raise ValueError("retrieval message too large")
    connection.sendall(struct.pack("!I", len(data))+data)


class RetrievalClient:
    def __init__(self, root: Path, threads: int):
        self.connection, child = socket.socketpair()
        self.connection.settimeout(60)
        self.process = subprocess.Popen(
            [sys.executable, str(Path(__file__)), "--fd", str(child.fileno()),
             "--root", str(root.resolve()), "--threads", str(threads)],
            pass_fds=(child.fileno(),),
        )
        child.close()
        if receive(self.connection) != {"ready": True}:
            raise RuntimeError("retrieval executor did not become ready")

    def call(self, operation, **values):
        send(self.connection, {"op": operation, **values})
        response = receive(self.connection)
        if "error" in response:
            raise RuntimeError(response["error"])
        return response

    def close(self):
        try:
            self.call("stop")
            self.process.wait(timeout=10)
        finally:
            self.connection.close()
            if self.process.poll() is None:
                self.process.kill()
                self.process.wait()


def serve(args):
    import faiss
    import numpy as np

    faiss.omp_set_num_threads(args.threads)
    connection = socket.socket(fileno=args.fd)
    index = None
    send(connection, {"ready": True})
    while True:
        try:
            request = receive(connection)
        except EOFError:
            break
        try:
            if request["op"] == "stop":
                send(connection, {"stopped": True})
                break
            if request["op"] == "load":
                path = Path(request["path"]).resolve()
                if not path.is_relative_to(args.root.resolve()):
                    raise ValueError("matrix outside isolated benchmark root")
                matrix = np.load(path, allow_pickle=False)
                if matrix.dtype != np.float32 or matrix.ndim != 2 or not np.isfinite(matrix).all():
                    raise ValueError("invalid feature matrix")
                index = faiss.IndexFlatIP(matrix.shape[1])
                started = time.perf_counter()
                index.add(matrix)
                send(connection, {"vectors": index.ntotal, "build_ms": (time.perf_counter()-started)*1000})
            elif request["op"] == "search":
                features = np.ascontiguousarray(request["vectors"], dtype=np.float32)
                scores, ids = index.search(features, min(index.ntotal, int(request["k"])))
                send(connection, {"scores": scores.tolist(), "ids": ids.tolist()})
            elif request["op"] == "scale":
                count, dimension = int(request["count"]), int(request["dimension"])
                matrix = np.random.default_rng(20261114).standard_normal((count, dimension), dtype=np.float32)
                faiss.normalize_L2(matrix)
                scale = faiss.IndexFlatIP(dimension)
                started = time.perf_counter()
                scale.add(matrix)
                build_ms = (time.perf_counter()-started)*1000
                timings = []
                query = np.ascontiguousarray(request["queries"], dtype=np.float32)
                for n in range(128):
                    feature = query[n % len(query):n % len(query)+1]
                    started = time.perf_counter()
                    scale.search(feature, 20)
                    timings.append((time.perf_counter()-started)*1000)
                send(connection, {"matrix_mib": matrix.nbytes/1024**2, "index_build_ms": build_ms,
                                  "search_timings_ms": timings})
                del scale, matrix
            else:
                raise ValueError("unknown operation")
        except Exception as error:
            send(connection, {"error": str(error)})
    connection.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fd", required=True, type=int)
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument("--threads", required=True, type=int)
    serve(parser.parse_args())
