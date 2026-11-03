"""Download the unmodified preview URLs returned by Canva draft transactions."""
import concurrent.futures
import hashlib
import json
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "artifacts/instagram-canva-20261103/production/revision5/preview-downloads.json"
records = json.loads(SOURCE.read_text())
CACHE = SOURCE.parent / "preview-download-cache.json"
cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
if len(records) != 98 or len({(r["key"], r["page"]) for r in records}) != 98:
    raise ValueError("A complete set of 98 unique Canva previews is required")


def download(record):
    target = (ROOT / record["file"]).resolve()
    target.relative_to(ROOT / "artifacts/instagram-canva-20261103/production/revision5/previews")
    url = urlparse(record["url"])
    if url.scheme != "https" or url.hostname != "export-download.canva.com":
        raise ValueError("Unexpected Canva preview origin")
    previous = cache.get(record["file"], {})
    if target.exists() and previous.get("url") == record["url"]:
        digest = hashlib.sha256(target.read_bytes()).hexdigest()
        if digest == previous.get("sha256"):
            return {"group": record["key"], "file": record["file"], "url": record["url"], "sha256": digest, "cached": True}
    with urlopen(record["url"], timeout=45) as response:
        payload = response.read(20_000_001)
    if len(payload) > 20_000_000 or not payload.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("Canva did not return a valid PNG preview")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(payload)
    return {"group": record["key"], "file": record["file"], "url": record["url"], "sha256": hashlib.sha256(payload).hexdigest(), "cached": False}


with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
    results = list(executor.map(download, records))
CACHE.write_text(json.dumps({r["file"]: {"url": r["url"], "sha256": r["sha256"]} for r in results}, indent=2) + "\n")
groups = [r["group"] for r in results]
print(json.dumps({"downloaded": sum(not r["cached"] for r in results), "cached": sum(r["cached"] for r in results), "groups": {g: groups.count(g) for g in sorted(set(groups))}}))
