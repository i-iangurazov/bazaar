"""Retrieval metrics at object identity level, with held-out rejection calibration."""
from __future__ import annotations

import math
import random
import statistics


def unique_products(scores: list[float], indexes: list[int], gallery: list[dict], limit=20):
    seen = set()
    result = []
    for score, index in zip(scores, indexes):
        if index < 0:
            continue
        item = gallery[index]
        if item["product_id"] in seen:
            continue
        seen.add(item["product_id"])
        result.append({"product_id": item["product_id"], "image_id": item["id"], "score": float(score)})
        if len(result) == limit:
            break
    return result


def rejection_threshold(unknown_scores: list[float], max_false_accept=0.05) -> float:
    if not unknown_scores or not all(math.isfinite(x) for x in unknown_scores):
        raise ValueError("finite unknown calibration scores are required")
    if not 0 <= max_false_accept < 1:
        raise ValueError("invalid false accept budget")
    scores = sorted(unknown_scores)
    # Accept score >= threshold. Reject ties at the quantile boundary so that
    # empirical calibration false accepts cannot exceed the declared budget.
    rank = math.ceil((1 - max_false_accept) * len(scores)) - 1
    return math.nextafter(scores[rank], math.inf)


def identity_bootstrap(rows: list[dict], key: str, iterations=1000) -> list[float]:
    groups = {}
    for row in rows:
        groups.setdefault(row["product_id"], []).append(float(row[key]))
    values = [statistics.mean(group) for group in groups.values()]
    if not values:
        return []
    rng = random.Random(20261114)
    estimates = sorted(statistics.mean(rng.choices(values, k=len(values))) for _ in range(iterations))
    return [estimates[int(0.025 * iterations)], estimates[int(0.975 * iterations)]]


def summarize(rows: list[dict], threshold: float) -> dict:
    known = [row for row in rows if row["known"]]
    unknown = [row for row in rows if not row["known"]]
    for row in known:
        rank = next((i + 1 for i, item in enumerate(row["matches"]) if item["product_id"] == row["product_id"]), None)
        row["top1"] = rank == 1
        row["top5"] = rank is not None and rank <= 5
        row["reciprocal_rank"] = 1 / rank if rank is not None else 0
    average = lambda values: statistics.mean(values) if values else None
    return {
        "known_queries": len(known),
        "unknown_queries": len(unknown),
        "known_identities": len({row["product_id"] for row in known}),
        "unknown_identities": len({row["product_id"] for row in unknown}),
        "recall_at_1": average([row["top1"] for row in known]),
        "recall_at_5": average([row["top5"] for row in known]),
        "recall_at_5_identity_bootstrap_95ci": identity_bootstrap(known, "top5"),
        "mrr_at_20": average([row["reciprocal_rank"] for row in known]),
        "threshold": threshold,
        "accepted_correct_top1_rate": average([row["top1"] and row["matches"][0]["score"] >= threshold for row in known]),
        "accepted_wrong_top1_rate": average([not row["top1"] and row["matches"][0]["score"] >= threshold for row in known]),
        "unknown_false_accept_rate": average([bool(row["matches"]) and row["matches"][0]["score"] >= threshold for row in unknown]),
        "by_condition": {
            condition: {
                "count": len(subset := [row for row in known if row["condition"] == condition]),
                "recall_at_1": average([row["top1"] for row in subset]),
                "recall_at_5": average([row["top5"] for row in subset]),
            }
            for condition in sorted({row["condition"] for row in known})
        },
    }


def validate_manifest(manifest: dict) -> None:
    entries = manifest["entries"]
    if len({row["id"] for row in entries}) != len(entries):
        raise ValueError("duplicate image identifiers")
    gallery = [row for row in entries if row["split"] == "gallery"]
    queries = [row for row in entries if row["split"] != "gallery"]
    if {row["sha256"] for row in gallery} & {row["sha256"] for row in queries}:
        raise ValueError("query/gallery exact-file leakage")
    calibration = {row["product_id"] for row in queries if row["split"] == "calibration"}
    test = {row["product_id"] for row in queries if row["split"] == "test"}
    if calibration & test:
        raise ValueError("calibration/test identities overlap")
    gallery_ids = {row["product_id"] for row in gallery}
    for row in queries:
        if row["known"] != (row["product_id"] in gallery_ids):
            raise ValueError("known/unknown ground truth disagrees with gallery")
    for split in ["calibration", "test"]:
        for known in [True, False]:
            if not any(row["split"] == split and row["known"] == known for row in queries):
                raise ValueError("both query splits require known and unknown objects")
