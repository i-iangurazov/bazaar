"""Download only the pinned public PP-ShiTu model, once during setup."""
import argparse
import importlib.util
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(".local/product-photo-search/runtime"))
    args = parser.parse_args()
    # Reuse the bounded downloader and safe archive extraction from the benchmark.
    source = Path(__file__).resolve().parents[2]/"scripts/benchmarks/product-photo/prepare.py"
    spec = importlib.util.spec_from_file_location("assets", source)
    assets = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(assets)
    archive = args.root/"assets/pp-shitu-v2.tar"
    assets.download(assets.PP_URL, archive, 30_000_000, assets.PP_SHA256)
    assets.extract(archive, args.root/"models")
    print(args.root/"models/general_PPLCNetV2_base_pretrained_v1.0_infer")


if __name__ == "__main__":
    main()
