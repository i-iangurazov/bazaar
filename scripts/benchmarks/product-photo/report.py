"""Verify a completed comparison and publish compact, reviewable evidence."""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
from pathlib import Path
import random
import shutil
import statistics

from prepare import sha256


def paired_interval(first, second, iterations=5000):
    a = {row["id"]: row for row in first if row["split"] == "test" and row["known"]}
    b = {row["id"]: row for row in second if row["split"] == "test" and row["known"]}
    if a.keys() != b.keys():
        raise ValueError("models did not evaluate the same queries")
    groups = {}
    for key, row in a.items():
        def found(item):
            return any(match["product_id"] == item["product_id"] for match in item["matches"][:5])
        groups.setdefault(row["product_id"], []).append(int(found(row))-int(found(b[key])))
    differences = [statistics.mean(values) for values in groups.values()]
    rng = random.Random(20261114)
    estimates = sorted(statistics.mean(rng.choices(differences, k=len(differences))) for _ in range(iterations))
    return {"pp_minus_cn_recall_at_5": statistics.mean(differences),
            "paired_identity_bootstrap_95ci": [estimates[int(iterations*0.025)], estimates[int(iterations*0.975)]],
            "identities": len(differences), "iterations": iterations}


def main(args):
    root = args.root.resolve()
    result = args.results.resolve()
    evidence = args.evidence
    evidence.mkdir(parents=True, exist_ok=True)
    models = {name: json.loads((result/f"{name}-2t.json").read_text()) for name in ["ppshitu", "chineseclip"]}
    if len({item["dataset_manifest_sha256"] for item in models.values()}) != 1:
        raise ValueError("different datasets cannot be compared")
    if len({item["harness_sha256"] for item in models.values()}) != 1:
        raise ValueError("different benchmark harnesses cannot be compared")
    for item in models.values():
        for name, digest in item["harness_files"].items():
            if sha256(Path(__file__).with_name(name)) != digest:
                raise ValueError(f"runtime source changed since measurement: {name}")
    manifest = json.loads((root/"dataset.json").read_text())
    if sha256(root/"dataset.json") != models["ppshitu"]["dataset_manifest_sha256"]:
        raise ValueError("dataset manifest changed since measurement")
    paired = paired_interval(
        json.loads((result/"ppshitu-2t.queries.json").read_text()),
        json.loads((result/"chineseclip-2t.queries.json").read_text()),
    )
    protocol = {
        "date": "2026-11-14", "dataset_manifest_sha256": sha256(root/"dataset.json"),
        "known_products": manifest["known_products"], "unknown_products": manifest["unknown_products"],
        "images": len(manifest["entries"]),
        "image_sizes": sorted({(item["width"], item["height"]) for item in manifest["entries"]}),
        "excluded_query_gallery_duplicates": manifest["excluded_query_gallery_duplicates"],
        "paired_comparison": paired,
        "model_assets": json.loads((root/"model-assets.json").read_text()),
        "raw_evidence_hashes": {path.name: sha256(path) for path in result.iterdir()
                                if path.name.endswith((".queries.json", ".timings.json", ".features.npz"))},
    }
    for name in models:
        shutil.copyfile(result/f"{name}-2t.json", evidence/f"{name}-2t.json")
    (evidence/"protocol.json").write_text(json.dumps(protocol, indent=2)+"\n")
    (evidence/"dataset-manifest.json.gz").write_bytes(gzip.compress((root/"dataset.json").read_bytes(), mtime=0))
    print(json.dumps({name: {
        "test": item["quality"]["test"],
        "warm_p95_ms": item["warm_query_ms"]["total_ms"]["p95"],
        "concurrency_4_p95_ms": item["concurrency"][1]["response_ms"]["p95"],
        "query_rss_mib": item["phases"]["warm_single_query"]["peak_rss_mib"],
        "max_rss_mib": item["max_sampled_rss_mib"],
        "gallery_seconds": item["phases"]["gallery_embedding"]["wall_seconds"],
        "query_cpu_percent": item["phases"]["warm_single_query"]["cpu_percent_one_core_100"],
        "one_client_qps": item["concurrency"][0]["throughput_requests_per_second"],
    } for name, item in models.items()},indent=2))
    print(json.dumps(paired, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(".local/photo-search-benchmark"))
    parser.add_argument("--results", type=Path, default=Path(".local/photo-search-benchmark/results-final"))
    parser.add_argument("--evidence", type=Path, default=Path("docs/benchmarks/product-photo-20261114"))
    main(parser.parse_args())
