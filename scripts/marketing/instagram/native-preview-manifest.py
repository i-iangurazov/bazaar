"""Verify actual native Canva element snapshots and unmodified preview provenance."""
import hashlib
import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
BASE = ROOT / "artifacts/instagram-canva-20261103/production/revision5"
DOCS = ROOT / "docs/marketing/instagram-2026-11"
plan = json.loads((DOCS / "native-v5-plan.json").read_text())
native = json.loads((BASE / "native-element-evidence.json").read_text())
records = json.loads((BASE / "preview-downloads.json").read_text())


def sha(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


result = []
for record in records:
    group, page = record["key"], record["page"]
    spec = plan["designs"][group]["pages"][page - 1]
    state = native[group]
    texts = sorted([x for x in state["richtexts"] if x["page_index"] == page], key=lambda x: x["containerElement"]["position"]["top"])
    fills = [x for x in state["fills"] if x["page_index"] == page]
    logos = [x for x in fills if x["asset_id"] == plan["logoAsset"]]
    if len(texts) != 2 or len(logos) != 1:
        raise ValueError(f"Missing native text or original logo: {group}/{page}")
    wording = ["".join(region["text"] for region in x["regions"]) for x in texts]
    if wording != [spec["headline"], spec["body"]]:
        raise ValueError(f"Native text differs from the plan: {group}/{page}")
    if len(fills) != (1 if spec["layout"] == "information" else 2):
        raise ValueError(f"Unexpected image layers: {group}/{page}")
    for text in texts:
        box = text["containerElement"]
        if box["position"]["left"] + box["dimension"]["width"] > 1001 or box["position"]["top"] + box["dimension"]["height"] > spec["size"][1] - 60:
            raise ValueError(f"Text extends beyond the reserved canvas margins: {group}/{page}")
    if texts[0]["containerElement"]["dimension"]["height"] >= 200:
        raise ValueError(f"Headline wraps beyond two lines: {group}/{page}")
    logo = logos[0]["containerElement"]["dimension"]
    if abs(logo["width"] / logo["height"] - 4) > 0.001:
        raise ValueError(f"Original logo proportions changed: {group}/{page}")
    sources = [{"file": "public/brand/logo.png", "sha256": sha(ROOT / "public/brand/logo.png")}]
    if spec["layout"] == "photo":
        asset = plan["photos"][spec["photoKey"]]
        if not any(x["asset_id"] == asset["asset"] for x in fills):
            raise ValueError(f"Wrong photo asset: {group}/{page}")
        sources.append({"file": asset["file"], "sha256": sha(ROOT / asset["file"])})
    if spec["layout"] == "application":
        asset = plan["appScreens"][spec["screenKey"]]
        if not any(x["asset_id"] == asset["asset"] for x in fills):
            raise ValueError(f"Wrong real application screenshot: {group}/{page}")
        sources.append({"file": asset["file"], "sha256": sha(ROOT / asset["file"])})
        placement = spec["screenPlacement"]
        if texts[0]["containerElement"]["position"]["top"] + texts[0]["containerElement"]["dimension"]["height"] > placement["top"] - 18 or placement["top"] + placement["height"] > texts[1]["containerElement"]["position"]["top"] - 18:
            raise ValueError(f"Native text overlaps the screenshot: {group}/{page}")
    file = ROOT / record["file"]
    data = file.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"Not a PNG: {file}")
    size = list(struct.unpack(">II", data[16:24]))
    if abs(size[0] / size[1] - spec["size"][0] / spec["size"][1]) > 0.005:
        raise ValueError(f"Wrong preview aspect ratio: {group}/{page}")
    result.append({"group": group, "page": page, "itemId": spec["itemId"], "layout": spec["layout"], "file": record["file"], "size": size, "sha256": sha(file), "nativeTextCount": len(texts), "originalLogoCount": len(logos), "imageLayerCount": len(fills), "sources": sources})
if len(result) != 98 or len({(x["group"], x["page"]) for x in result}) != 98:
    raise ValueError("Incomplete native release preview")
out = {"revision": 5, "status": "uncommitted_native_drafts_ready_for_save_confirmation", "publicationEnabled": False, "paidBudget": None, "nativeTextObjects": 196, "pages": result, "layerEvidence": "artifacts/instagram-canva-20261103/production/revision5/native-element-evidence.json", "nativeTypography": {"family": "Inter", "headlineCanvaSize": 66, "bodyCanvaSize": 34, "weight": "bold", "evidence": "Inherited from the same UI-verified native master. Native text replacement and full-copy checks passed."}}
(DOCS / "native-v5-preview.json").write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({"previews": len(result), "nativeTextObjects": 196, "originalLogos": 98, "flatTextCards": 0, "layouts": {k: sum(x["layout"] == k for x in result) for k in ["photo", "application", "information"]}}))
