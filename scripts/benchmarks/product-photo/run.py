"""Offline CPU comparison. Each framework runs in a separate, credential-free process."""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import random
import statistics
import subprocess
import sys
import threading
import time

from metrics import rejection_threshold, summarize, unique_products, validate_manifest


def distribution(values):
    import numpy as np

    return {
        "count": len(values), "mean": float(np.mean(values)), "p50": float(np.percentile(values, 50)),
        "p95": float(np.percentile(values, 95)), "p99": float(np.percentile(values, 99)),
        "min": float(np.min(values)), "max": float(np.max(values)),
    }


class ResourceMonitor:
    def __init__(self):
        import psutil

        self.process = psutil.Process()
        self.psutil = psutil
        self.samples = []
        self.phases = {}
        self.current_phase = "initialization"
        self.cpu_observations = {}
        self.cpu_lock = threading.Lock()
        self.failure = None
        self.stop = threading.Event()
        self.thread = threading.Thread(target=self._sample, daemon=True)

    def _sample(self):
        try:
            while not self.stop.is_set():
                self.samples.append({"time": time.perf_counter(), "phase": self.current_phase,
                                     "rss": self.rss()})
                self.cpu()
                self.stop.wait(0.02)
        except Exception as error:
            self.failure = str(error)

    def cpu(self):
        # Import helpers can exit between process enumeration and measurement.
        # Keep their last CPU observations, so a disappearing child cannot make
        # a phase's cumulative CPU time decrease.
        with self.cpu_lock:
            for process in [self.process]+self.process.children(recursive=True):
                try:
                    value = process.cpu_times()
                    key = (process.pid, process.create_time())
                    self.cpu_observations[key] = max(self.cpu_observations.get(key, 0), value.user+value.system)
                except (self.psutil.NoSuchProcess, self.psutil.AccessDenied):
                    continue
            return sum(self.cpu_observations.values())

    def rss(self):
        total = 0
        for process in [self.process]+self.process.children(recursive=True):
            try:
                total += process.memory_info().rss
            except (self.psutil.NoSuchProcess, self.psutil.AccessDenied):
                continue
        return total

    @contextmanager
    def phase(self, name):
        self.current_phase = name
        started, cpu_start = time.perf_counter(), self.cpu()
        rss_start = self.rss()
        try:
            yield
        finally:
            elapsed, cpu_seconds = time.perf_counter() - started, self.cpu() - cpu_start
            peak = max([rss_start, self.rss()] +
                       [sample["rss"] for sample in self.samples if sample["phase"] == name])
            self.phases[name] = {
                "wall_seconds": elapsed, "cpu_seconds": cpu_seconds,
                "cpu_percent_one_core_100": 100 * cpu_seconds / elapsed,
                "peak_rss_mib": peak / 1024**2,
                "end_rss_mib": self.rss() / 1024**2,
            }
            self.current_phase = "idle"


def worker(args):
    import numpy as np
    import psutil
    from backends import ChineseCLIP, PPShiTu
    from prepare import sha256
    from retrieval import RetrievalClient

    root = args.root.resolve()
    args.out.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((root / "dataset.json").read_text())
    validate_manifest(manifest)
    entries = manifest["entries"]
    for item in entries:
        path = (root / item["path"]).resolve()
        if not path.is_relative_to(root) or sha256(path) != item["sha256"]:
            raise ValueError(f"image integrity mismatch: {item['id']}")
    gallery = [item for item in entries if item["split"] == "gallery"]
    queries = [item for item in entries if item["split"] != "gallery"]
    monitor = ResourceMonitor()
    monitor.thread.start()
    baseline = monitor.rss() / 1024**2
    with monitor.phase("retrieval_service_load"):
        retrieval = RetrievalClient(root, args.threads)
    with monitor.phase("model_load"):
        backend = (PPShiTu if args.worker == "ppshitu" else ChineseCLIP)(root, args.threads)
    print(f"{args.worker}: model ready", flush=True)

    def encode(paths):
        prepared = backend.prepare(paths)
        vector = np.ascontiguousarray(backend.infer(prepared), dtype=np.float32)
        if vector.ndim != 2 or vector.shape[0] != len(paths) or not np.isfinite(vector).all():
            raise ValueError("invalid model features")
        if (np.linalg.norm(vector, axis=1) < 1e-8).any():
            raise ValueError("zero model features")
        vector /= np.linalg.norm(vector, axis=1, keepdims=True)
        return vector

    first_started = time.perf_counter()
    with monitor.phase("first_image"):
        first = encode([root / queries[0]["path"]])
    first_ms = (time.perf_counter() - first_started) * 1000
    with monitor.phase("warmup"):
        for _ in range(5):
            encode([root / queries[0]["path"]])

    def embed_all(items, phase):
        vectors = []
        with monitor.phase(phase):
            for offset in range(0, len(items), args.batch_size):
                batch = items[offset:offset + args.batch_size]
                vectors.append(encode([root / item["path"] for item in batch]))
                if offset % (args.batch_size * 20) == 0:
                    print(f"{args.worker}: {phase} {offset}/{len(items)}", flush=True)
        return np.concatenate(vectors)

    gallery_vectors = embed_all(gallery, "gallery_embedding")
    query_vectors = embed_all(queries, "query_embedding")
    if gallery_vectors.shape[1] != first.shape[1]:
        raise ValueError("model dimensions changed")
    matrix_path = args.out / f"{args.worker}-{args.threads}t.gallery.npy"
    np.save(matrix_path, gallery_vectors, allow_pickle=False)
    with monitor.phase("index_build"):
        retrieval.call("load", path=str(matrix_path.resolve()))
    top_k_images = min(len(gallery), 40)
    rows = []
    with monitor.phase("quality_search"):
        for offset, query in enumerate(queries):
            response = retrieval.call("search", vectors=query_vectors[offset:offset + 1].tolist(), k=top_k_images)
            rows.append({
                "id": query["id"], "product_id": query["product_id"], "known": query["known"],
                "condition": query["condition"], "split": query["split"],
                "matches": unique_products(response["scores"][0], response["ids"][0], gallery),
            })
    calibration = [row for row in rows if row["split"] == "calibration"]
    threshold = rejection_threshold([row["matches"][0]["score"] for row in calibration if not row["known"]])
    quality = {
        "calibration": summarize(calibration, threshold),
        "test": summarize([row for row in rows if row["split"] == "test"], threshold),
    }

    rng = random.Random(20261114)
    timed_queries = [item for item in queries if item["split"] == "test"]
    rng.shuffle(timed_queries)
    timed_queries = timed_queries[:128]
    query_timings = []
    with monitor.phase("warm_single_query"):
        for query in timed_queries:
            started = time.perf_counter()
            preprocessed = backend.prepare([root / query["path"]])
            preprocessed_at = time.perf_counter()
            feature = np.ascontiguousarray(backend.infer(preprocessed), dtype=np.float32)
            feature /= np.linalg.norm(feature, axis=1, keepdims=True)
            inferred_at = time.perf_counter()
            response = retrieval.call("search", vectors=feature.tolist(), k=top_k_images)
            unique_products(response["scores"][0], response["ids"][0], gallery)
            finished = time.perf_counter()
            query_timings.append({"id": query["id"], "total_ms": (finished-started)*1000,
                                  "preprocess_ms": (preprocessed_at-started)*1000,
                                  "inference_normalize_ms": (inferred_at-preprocessed_at)*1000,
                                  "search_group_ms": (finished-inferred_at)*1000})

    # A single model executor, as proposed for the first CPU service. Client
    # concurrency includes queue waiting; it is not four unsafe model replicas.
    capacity_lock = threading.Lock()
    concurrency = []
    for clients in [1, 4]:
        def request(number):
            arrival = time.perf_counter()
            query = timed_queries[number % len(timed_queries)]
            with capacity_lock:
                service_started = time.perf_counter()
                feature = encode([root / query["path"]])
                response = retrieval.call("search", vectors=feature.tolist(), k=top_k_images)
                unique_products(response["scores"][0], response["ids"][0], gallery)
            finished = time.perf_counter()
            return {"response_ms": (finished-arrival)*1000, "queue_ms": (service_started-arrival)*1000}

        with monitor.phase(f"clients_{clients}"):
            started = time.perf_counter()
            with ThreadPoolExecutor(max_workers=clients) as pool:
                samples = list(pool.map(request, range(64)))
            wall = time.perf_counter()-started
        concurrency.append({"clients": clients, "requests": len(samples), "wall_seconds": wall,
                            "throughput_requests_per_second": len(samples)/wall,
                            "response_ms": distribution([row["response_ms"] for row in samples]),
                            "queue_ms": distribution([row["queue_ms"] for row in samples])})

    scales = []
    # Artificial vectors measure index cost only, never semantic quality. A
    # shared seeded generator and common Faiss backend keep the comparison fair.
    for count in [1000, 10_000, 50_000]:
        with monitor.phase(f"synthetic_index_{count}"):
            response = retrieval.call("scale", count=count, dimension=first.shape[1], queries=query_vectors[:16].tolist())
            scales.append({"vector_count": count, "dimension": first.shape[1], "synthetic": True,
                           "matrix_mib": response["matrix_mib"], "index_build_ms": response["index_build_ms"],
                           "search_ms": distribution(response["search_timings_ms"])})

    monitor.stop.set()
    monitor.thread.join()
    if monitor.failure:
        retrieval.close()
        raise RuntimeError(f"invalid resource telemetry: {monitor.failure}")
    result = {
        "schema_version": 1, "model": args.worker, "description": backend.name,
        "host": {"platform": platform.platform(), "machine": platform.machine(),
                 "cpu": subprocess.check_output(["sysctl", "-n", "machdep.cpu.brand_string"], text=True).strip()
                        if platform.system() == "Darwin" else platform.processor(),
                 "logical_cpus": psutil.cpu_count(), "physical_cpus": psutil.cpu_count(logical=False),
                 "memory_mib": psutil.virtual_memory().total/1024**2,
                 "python": platform.python_version(), "device": "cpu", "math_threads": args.threads},
        "versions": {package: importlib.metadata.version(package) for package in
                     ["paddlepaddle", "torch", "torchvision", "faiss-cpu", "numpy", "pillow", "opencv-python-headless"]},
        "dataset_manifest_sha256": sha256(root / "dataset.json"),
        "harness_sha256": hashlib.sha256(b"".join(
            name.encode()+Path(__file__).with_name(name).read_bytes()
            for name in ["run.py", "backends.py", "metrics.py", "prepare.py", "retrieval.py"]
        )).hexdigest(),
        "harness_files": {name: sha256(Path(__file__).with_name(name)) for name in
                          ["run.py", "backends.py", "metrics.py", "prepare.py", "retrieval.py"]},
        "gallery_images": len(gallery), "gallery_products": len({item["product_id"] for item in gallery}),
        "query_images": len(queries), "feature_dimension": first.shape[1], "batch_size_indexing": args.batch_size,
        "weights_bytes": backend.weights_bytes, "first_image_encode_ms": first_ms,
        "baseline_rss_mib": baseline,
        "max_sampled_rss_mib": max(sample["rss"] for sample in monitor.samples)/1024**2,
        "memory_sample_interval_ms": 20,
        "resource_scope": "aggregate RSS/CPU of embedding process and private Faiss child; shared libraries may be double-counted",
        "phases": monitor.phases, "quality": quality,
        "warm_query_ms": {key: distribution([row[key] for row in query_timings]) for key in
                          ["total_ms", "preprocess_ms", "inference_normalize_ms", "search_group_ms"]},
        "concurrency": concurrency, "synthetic_index_scale": scales,
        "limitations": ["Public low-resolution tabletop objects, not Bazaar SKU/shop-camera validation",
                        "Host CPU only; excludes HTTP, authorization, database and network latency",
                        "Whole-object photos; detector/crop stage not benchmarked",
                        "Process model load, not a cleared OS filesystem cache",
                        "Warm query includes local private IPC, excludes a production API/database round trip",
                        "Synthetic index sizes assess compute/memory only, not retrieval recall"],
    }
    output = args.out / f"{args.worker}-{args.threads}t"
    output.with_suffix(".json").write_text(json.dumps(result, indent=2)+"\n")
    output.with_suffix(".queries.json").write_text(json.dumps(rows, indent=2)+"\n")
    output.with_suffix(".timings.json").write_text(json.dumps(query_timings, indent=2)+"\n")
    np.savez_compressed(str(output)+".features.npz", gallery=gallery_vectors, query=query_vectors)
    retrieval.close()
    print(f"Completed {args.worker}: R@5={quality['test']['recall_at_5']:.3f}, "
          f"p95={result['warm_query_ms']['total_ms']['p95']:.1f}ms", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(".local/photo-search-benchmark"))
    parser.add_argument("--out", type=Path, default=Path(".local/photo-search-benchmark/results"))
    parser.add_argument("--threads", type=int, choices=[1, 2, 4], default=2)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--models", nargs="+", choices=["ppshitu", "chineseclip"], default=["ppshitu", "chineseclip"])
    parser.add_argument("--worker", choices=["ppshitu", "chineseclip"])
    args = parser.parse_args()
    if not args.out.resolve().is_relative_to(args.root.resolve()):
        raise ValueError("output directory must be inside the isolated work root")
    if args.worker:
        worker(args)
        return
    args.out.mkdir(parents=True, exist_ok=True)
    # No application .env loading or inherited database/provider credentials.
    env = {key: value for key, value in os.environ.items() if key in
           ["PATH", "HOME", "LANG", "LC_ALL", "TMPDIR", "SYSTEMROOT"]}
    env.update({"OMP_NUM_THREADS": "1", "MKL_NUM_THREADS": str(args.threads),
                "OPENBLAS_NUM_THREADS": str(args.threads), "VECLIB_MAXIMUM_THREADS": str(args.threads),
                "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1", "TOKENIZERS_PARALLELISM": "false"})
    for model in args.models:
        command = [sys.executable, str(Path(__file__)), "--worker", model, "--root", str(args.root),
                   "--out", str(args.out), "--threads", str(args.threads), "--batch-size", str(args.batch_size)]
        with (args.out / f"{model}-{args.threads}t.log").open("w") as log:
            print(f"Running {model}; log {log.name}", flush=True)
            subprocess.run(command, env=env, stdout=log, stderr=subprocess.STDOUT, check=True, timeout=1800)


if __name__ == "__main__":
    main()
