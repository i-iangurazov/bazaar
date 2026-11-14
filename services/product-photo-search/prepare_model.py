"""Download only the pinned public PP-ShiTu model, once during setup."""
import argparse
import importlib.util
import hashlib
import json
import shutil
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(".local/product-photo-search/runtime"))
    parser.add_argument("--with-vision", action="store_true", help="Also prepare the pinned mainbody detector and bundled RapidOCR models")
    args = parser.parse_args()
    # Reuse the bounded downloader and safe archive extraction from the benchmark.
    source = Path(__file__).resolve().parents[2]/"scripts/benchmarks/product-photo/prepare.py"
    spec = importlib.util.spec_from_file_location("assets", source)
    assets = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(assets)
    archive = args.root/"assets/pp-shitu-v2.tar"
    assets.download(assets.PP_URL, archive, 30_000_000, assets.PP_SHA256)
    assets.extract(archive, args.root/"models")
    if args.with_vision:
        import rapidocr
        registry = json.loads(Path(__file__).with_name('vision-models.json').read_text())
        archive = args.root/'assets/picodet.tar'
        assets.download(registry['detectorUrl'], archive, 40_000_000, registry['archiveSha256'])
        destination = args.root/'models/vision'
        assets.extract(archive, destination)
        (destination/'ocr').mkdir(exist_ok=True)
        for name, expected in registry['files'].items():
            path = destination/name
            if name.startswith('ocr/'):
                original = Path(rapidocr.__file__).parent/'models'/Path(name).name
                if hashlib.sha256(original.read_bytes()).hexdigest() != expected:
                    raise ValueError('unexpectedBundledOcrModel')
                shutil.copyfile(original, path)
            if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
                raise ValueError('unexpectedVisionModel')
        print(destination)
    print(args.root/"models/general_PPLCNetV2_base_pretrained_v1.0_infer")


if __name__ == "__main__":
    main()
