"""Fetch only pinned public model artifacts; no accounts, hosted inference or DB."""
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
from prepare import download


def main():
    manifest = json.loads(Path('scripts/benchmarks/product-photo/elfbar-models.json').read_text())
    root = Path('.local/elfbar-model-comparison/models')

    def model(spec):
        target = root/spec['id']
        target.mkdir(parents=True, exist_ok=True)
        for name, asset in spec['files'].items():
            print(f"Preparing {spec['id']}/{name}", flush=True)
            download(asset['url'], target/name, asset['bytes']+1, asset['sha256'])
            if (target/name).stat().st_size != asset['bytes']:
                raise ValueError('unexpectedModelSize')
        print(f"Verified {spec['id']}", flush=True)

    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(model, manifest['models']))


if __name__ == '__main__':
    main()
