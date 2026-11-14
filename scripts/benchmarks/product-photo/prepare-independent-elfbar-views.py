"""Freeze native detector proposals, with no new retrieval inference or labels as inputs."""
import hashlib
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path('services/product-photo-search').resolve()))
import cv2
from engine import Encoder
from vision import Vision, crop_region


def main():
    root = Path('.local/elfbar-independent')
    data = json.loads((root/'inputs.json').read_text())
    vision = Vision(Path('.local/product-photo-search/runtime/models/vision'), 1)
    (root/'views').mkdir(exist_ok=True)
    for query in data['queries']:
        path = root/query['file']
        assert hashlib.sha256(path.read_bytes()).hexdigest() == query['sha256']
        pixels = Encoder.decode(path.read_bytes())
        views = [{'kind': 'full', 'file': query['file'], 'sha256': query['sha256'], 'region': None}]
        for index, (confidence, region) in enumerate(vision.propose(pixels)):
            file = f"views/{query['id']}-{index}.png"
            crop = crop_region(pixels, region)
            assert cv2.imwrite(str(root/file), cv2.cvtColor(crop, cv2.COLOR_RGB2BGR))
            views.append({'kind': 'detection', 'file': file, 'region': region,
                'confidence': confidence, 'sha256': hashlib.sha256((root/file).read_bytes()).hexdigest()})
        assert 1 <= len(views) <= 6
        query['automaticViews'] = views
    (root/'frozen-inputs.json').write_text(json.dumps(data, indent=2)+'\n')
    print(json.dumps({'queries': len(data['queries']), 'manualRegions': 0, 'retrievalInference': False}))


if __name__ == '__main__':
    main()
