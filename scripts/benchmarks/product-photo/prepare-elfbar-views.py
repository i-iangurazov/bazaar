"""Freeze identical PicoDet proposals/crop pixels before comparing encoders."""
import hashlib
import json
from pathlib import Path
import sys
sys.path.insert(0, str(Path('services/product-photo-search').resolve()))
import cv2
from engine import Encoder
from vision import Vision, crop_region


def main():
    root = Path('.local/elfbar-model-comparison')
    data = json.loads((root/'inputs.json').read_text())
    vision = Vision(Path('.local/product-photo-search/runtime/models/vision'), 1)
    (root/'views').mkdir(exist_ok=True)
    for split in ['calibration', 'test']:
        for query in data[split]['queries']:
            path = root/query['file']
            assert hashlib.sha256(path.read_bytes()).hexdigest() == query['sha256']
            pixels = Encoder.decode(path.read_bytes())
            query['automaticViews'] = [{'kind': 'full', 'file': query['file'], 'sha256': query['sha256'], 'region': None}]
            proposals = [('detection', box, confidence) for confidence, box in vision.propose(pixels)]
            if query.get('region'):
                proposals.append(('manual', query['region'], None))
            query['manualViews'] = []
            for index, (kind, region, confidence) in enumerate(proposals):
                file = f"views/{split}-{query['id']}-{index}.png"
                crop = crop_region(pixels, region)
                assert cv2.imwrite(str(root/file), cv2.cvtColor(crop, cv2.COLOR_RGB2BGR))
                row = {'kind': kind, 'region': region, 'confidence': confidence, 'file': file,
                    'pixels': [crop.shape[1], crop.shape[0]], 'sha256': hashlib.sha256((root/file).read_bytes()).hexdigest()}
                query['manualViews' if kind == 'manual' else 'automaticViews'].append(row)
            assert 1 <= len(query['automaticViews']) <= 6
    (root/'frozen-inputs.json').write_text(json.dumps(data, indent=2)+'\n')
    print(json.dumps({'calibrationQueries': len(data['calibration']['queries']), 'testQueries': len(data['test']['queries']), 'inference': 'PicoDet only; encoder comparison not started'}))


if __name__ == '__main__':
    main()
