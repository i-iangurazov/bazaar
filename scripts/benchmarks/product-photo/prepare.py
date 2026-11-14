"""Fetch public evaluation assets only; no database or paid inference API access."""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
from pathlib import Path
import random
import tarfile
import time
import urllib.request

PP_URL = (
    "https://paddle-imagenet-models-name.bj.bcebos.com/dygraph/rec/models/"
    "inference/PP-ShiTuV2/general_PPLCNetV2_base_pretrained_v1.0_infer.tar"
)
CN_CODE_REVISION = "31863c707501bf1605d36842f43deb78793dbc5d"
CN_CODE_SHA256 = "48b04d626eec503243e5af8fda5da1bd15ef066a51c43bc882b1ffb1f69ac750"
PP_SHA256 = "b55f63f2f93eb42b0ff232154180f5e54d99da0891a200a2439d7a0a0ef8c026"
CN_WEIGHTS_REVISION = "36e679e65c2a2fead755ae21162091293ad37834"
CN_WEIGHTS_SHA256 = "5997ef32c50de18f3ac06eb5d746c324a639053c3bed8f2986f97ebb22b2ecde"
CN_WEIGHTS_URL = (
    "https://huggingface.co/OFA-Sys/chinese-clip-vit-base-patch16/resolve/"
    f"{CN_WEIGHTS_REVISION}/clip_cn_vit-b-16.pt"
)
ALOI_BASE = "https://aloi.science.uva.nl/www-images"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def download(url: str, target: Path, limit: int, expected: str | None = None) -> dict:
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() and (expected is None or sha256(target) == expected):
        return {"url": url, "bytes": target.stat().st_size, "sha256": sha256(target)}
    temporary = target.with_suffix(target.suffix + ".part")
    for attempt in range(3):
        try:
            size = 0
            with urllib.request.urlopen(url, timeout=60) as response, temporary.open("wb") as out:
                while chunk := response.read(1024 * 1024):
                    size += len(chunk)
                    if size > limit:
                        raise ValueError("download exceeds declared size limit")
                    out.write(chunk)
            if expected is not None and sha256(temporary) != expected:
                raise ValueError("asset checksum mismatch")
            temporary.replace(target)
            return {"url": url, "bytes": size, "sha256": sha256(target)}
        except Exception:
            temporary.unlink(missing_ok=True)
            if attempt == 2:
                raise
            time.sleep(attempt + 1)
    raise AssertionError("unreachable")


def extract(archive: Path, destination: Path) -> None:
    """Do not accept links, traversal, devices, or unbounded archive contents."""
    destination.mkdir(parents=True, exist_ok=True)
    root = destination.resolve()
    with tarfile.open(archive) as stream:
        members = stream.getmembers()
        if sum(member.size for member in members) > 200 * 1024 * 1024:
            raise ValueError("archive expands beyond limit")
        for member in members:
            path = (root / member.name).resolve()
            if not path.is_relative_to(root) or not (member.isfile() or member.isdir()):
                raise ValueError("unsafe archive member")
        stream.extractall(root, members=members, filter="data")


def models(root: Path) -> None:
    assets = root / "assets"
    records = {}
    for name, url, limit, expected, destination in [
        ("pp-shitu-v2.tar", PP_URL, 30_000_000, PP_SHA256, root / "models"),
        ("cn-clip-source.tar.gz", f"https://codeload.github.com/OFA-Sys/Chinese-CLIP/tar.gz/{CN_CODE_REVISION}", 40_000_000, CN_CODE_SHA256, root / "vendor"),
    ]:
        print(f"Preparing {name}", flush=True)
        archive = assets / name
        records[name] = download(url, archive, limit, expected)
        extract(archive, destination)
    print("Preparing Chinese-CLIP ViT-B/16 checkpoint", flush=True)
    records["clip_cn_vit-b-16.pt"] = download(
        CN_WEIGHTS_URL, root / "models/clip_cn_vit-b-16.pt", 800_000_000, CN_WEIGHTS_SHA256
    )
    records["cn_code_revision"] = CN_CODE_REVISION
    records["pp_code_revision"] = "202ac79a99aa368f2c95cb1871bbc11574f685da"
    records["cn_weights_revision"] = CN_WEIGHTS_REVISION
    (root / "model-assets.json").write_text(json.dumps(records, indent=2) + "\n")


def dataset(root: Path, known: int, unknown: int) -> None:
    from PIL import Image

    if known < 10 or unknown < 10 or known + unknown > 1000:
        raise ValueError("use 10..1000 ALOI objects with both known and unknown identities")
    ids = list(range(1, 1001))
    random.Random(20261114).shuffle(ids)
    known_ids, unknown_ids = ids[:known], ids[known : known + unknown]
    known_calibration = set(known_ids[: known // 3])
    unknown_calibration = set(unknown_ids[: unknown * 2 // 5])
    entries = []
    for product_id in known_ids + unknown_ids:
        is_known = product_id in known_ids
        calibration = product_id in known_calibration or product_id in unknown_calibration
        conditions = ["r0", "r90", "r30", "r60", "r180", "l3c1", "i120"] if is_known else ["r30", "r180", "i120"]
        for condition in conditions:
            gallery = is_known and condition in ["r0", "r90"]
            entries.append({
                "id": f"aloi-{product_id}-{condition}",
                "product_id": f"aloi-{product_id}",
                "known": is_known,
                "condition": condition,
                "split": "gallery" if gallery else "calibration" if calibration else "test",
                "path": f"images/{product_id}/{product_id}_{condition}.jpg",
                "url": f"{ALOI_BASE}/{product_id}/{product_id}_{condition}.jpg",
            })

    def fetch(entry: dict) -> dict:
        path = root / entry["path"]
        record = download(entry["url"], path, 4 * 1024 * 1024)
        with Image.open(path) as image:
            image.verify()
        with Image.open(path) as image:
            width, height = image.size
        return {**entry, "sha256": record["sha256"], "bytes": record["bytes"], "width": width, "height": height}

    results = []
    errors = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        pending = {pool.submit(fetch, entry): entry for entry in entries}
        for future in as_completed(pending):
            try:
                results.append(future.result())
            except Exception as error:
                errors.append({"id": pending[future]["id"], "error": str(error)})
            if (len(results) + len(errors)) % 100 == 0:
                print(f"Public dataset: {len(results)}/{len(entries)}, errors={len(errors)}", flush=True)
    if errors:
        (root / "dataset-errors.json").write_text(json.dumps(errors, indent=2) + "\n")
        raise RuntimeError(f"incomplete download: {len(errors)} images; no completed manifest published")
    results.sort(key=lambda item: item["id"])
    gallery_hashes = {item["sha256"] for item in results if item["split"] == "gallery"}
    excluded = [item["id"] for item in results if item["split"] != "gallery" and item["sha256"] in gallery_hashes]
    results = [item for item in results if item["id"] not in excluded]
    manifest = {
        "schema_version": 1,
        "name": "ALOI public photographic object retrieval; not Bazaar customer data",
        "source": "https://aloi.science.uva.nl/aloi/description.html",
        "citation": "J. M. Geusebroek, G. J. Burghouts, A. W. M. Smeulders. The Amsterdam Library of Object Images. IJCV 61(1), 103–112, 2005.",
        "seed": 20261114,
        "known_products": known,
        "unknown_products": unknown,
        "excluded_query_gallery_duplicates": excluded,
        "entries": results,
    }
    target = root / "dataset.json"
    target.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Dataset ready: {len(results)} images, manifest SHA256 {sha256(target)}", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["models", "dataset"])
    parser.add_argument("--root", type=Path, default=Path(".local/photo-search-benchmark"))
    parser.add_argument("--known", type=int, default=300)
    parser.add_argument("--unknown", type=int, default=100)
    args = parser.parse_args()
    args.root.mkdir(parents=True, exist_ok=True)
    if args.action == "models":
        models(args.root)
    else:
        dataset(args.root, args.known, args.unknown)
