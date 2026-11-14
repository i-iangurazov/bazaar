"""Stateless, private Faiss executor. No shared catalog and no image/URL storage."""
import base64
import json
from pathlib import Path
import socket
import struct
import subprocess
import sys

MAX_MESSAGE = 32 * 1024 * 1024
MAX_VECTORS = 10_000
DIMENSION = 512


def receive(connection):
    def exact(size):
        data = bytearray()
        while len(data) < size:
            value = connection.recv(size-len(data))
            if not value:
                raise EOFError()
            data.extend(value)
        return data
    size = struct.unpack("!I", exact(4))[0]
    if size > MAX_MESSAGE:
        raise ValueError("messageTooLarge")
    return json.loads(exact(size))


def send(connection, value):
    data = json.dumps(value, separators=(",", ":")).encode()
    if len(data) > MAX_MESSAGE:
        raise ValueError("messageTooLarge")
    connection.sendall(struct.pack("!I", len(data))+data)


class Searcher:
    def __init__(self, threads):
        self.threads = threads
        self.start()

    def start(self):
        threads = self.threads
        self.connection, child = socket.socketpair()
        self.connection.settimeout(20)
        self.process = subprocess.Popen([sys.executable, str(Path(__file__)), str(child.fileno()), str(threads)], pass_fds=(child.fileno(),))
        child.close()
        if receive(self.connection) != {"ready": True}:
            raise RuntimeError("retrievalNotReady")

    def search(self, matrix, groups, query):
        try:
            send(self.connection, {"matrix": matrix, "groups": groups, "query": query})
            result = receive(self.connection)
        except (OSError, EOFError):
            # A late response must never be consumed by the next store request.
            self.close()
            self.start()
            raise RuntimeError("retrievalRestarted")
        if not isinstance(result, dict) or "matches" not in result:
            raise ValueError("invalidSearch")
        return result["matches"]

    def close(self):
        self.connection.close()
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait()


def serve(fd, threads):
    import faiss
    import numpy as np
    faiss.omp_set_num_threads(threads)
    connection = socket.socket(fileno=fd)
    send(connection, {"ready": True})
    while True:
        try:
            request = receive(connection)
        except EOFError:
            break
        try:
            groups = request["groups"]
            count = len(groups)
            if not 1 <= count <= MAX_VECTORS or any(type(group) is not int or not 0 <= group < MAX_VECTORS for group in groups):
                raise ValueError("invalidGroups")
            raw = base64.b64decode(request["matrix"], validate=True)
            if len(raw) != count*DIMENSION*4:
                raise ValueError("invalidMatrix")
            matrix = np.frombuffer(raw, dtype="<f4").reshape(count, DIMENSION)
            query = np.ascontiguousarray([request["query"]], dtype=np.float32)
            if query.shape != (1, DIMENSION) or not np.isfinite(matrix).all() or not np.isfinite(query).all():
                raise ValueError("invalidMatrix")
            if not np.allclose(np.linalg.norm(matrix, axis=1), 1, atol=0.01):
                raise ValueError("invalidMatrix")
            index = faiss.IndexFlatIP(DIMENSION)
            index.add(matrix)
            scores, indexes = index.search(query, count)
            seen, matches = set(), []
            for score, number in zip(scores[0], indexes[0]):
                group = groups[int(number)]
                if group in seen:
                    continue
                seen.add(group)
                matches.append({"index": int(number), "score": float(score)})
                if len(matches) == 8:
                    break
            send(connection, {"matches": matches})
            del index, matrix, raw, query
        except (ValueError, TypeError, KeyError):
            send(connection, {"error": "invalidSearch"})
    connection.close()


if __name__ == "__main__":
    serve(int(sys.argv[1]), int(sys.argv[2]))
