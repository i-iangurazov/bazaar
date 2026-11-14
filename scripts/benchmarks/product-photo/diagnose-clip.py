"""Read-only exploratory comparison; scores are not calibrated for application use.

Reuse the pinned official Chinese-CLIP adapter and the same frozen foreground
proposals. Gallery JPEGs use the official CLIP transform, while PP scores come
from the running application's exported features. No index/database writes.
"""
import hashlib
import json
import os
from pathlib import Path
import sys
import time

os.environ.setdefault('OMP_NUM_THREADS', '1')
os.environ.setdefault('OPENBLAS_NUM_THREADS', '1')
sys.path.insert(0, str(Path('scripts/benchmarks/product-photo').resolve()))
from backends import ChineseCLIP
from prepare import CN_WEIGHTS_SHA256
import numpy as np
from PIL import Image


def main():
    root = Path('.local/elfbar-misses')
    data = json.loads((root/'input.json').read_text())
    diagnostic = json.loads((root/'diagnosis.json').read_text())
    benchmark = Path('.local/photo-search-benchmark')
    with (benchmark/'models/clip_cn_vit-b-16.pt').open('rb') as stream:
        assert hashlib.file_digest(stream, 'sha256').hexdigest() == CN_WEIGHTS_SHA256
    model = ChineseCLIP(benchmark, 1)

    def encode(image):
        with model.torch.inference_mode():
            vector = model.model(model.transform(image).unsqueeze(0)).float().cpu().numpy()[0]
        norm = np.linalg.norm(vector)
        assert np.isfinite(vector).all() and norm > 1e-8
        return vector/norm

    started = time.perf_counter()
    vectors = []
    for source in data['sources']:
        with Path(source['file']).open('rb') as stream:
            assert hashlib.file_digest(stream, 'sha256').hexdigest() == source['sha256']
        with Image.open(source['file']) as image:
            vectors.append(encode(image.convert('RGB')))
    matrix = np.array(vectors)
    results = []
    for row in data['queries']:
        pixels = Image.open(row['file']).convert('RGB')
        entry = next(value for value in diagnostic['results'] if value['id'] == row['id'])
        views = []
        for view in entry['low']['views']:
            box, image = view['region'], pixels
            if box:
                width, height = pixels.size
                left, top = int(box['x']*width), int(box['y']*height)
                right = min(width, int(np.ceil((box['x']+box['width'])*width)))
                bottom = min(height, int(np.ceil((box['y']+box['height'])*height)))
                image = pixels.crop((left, top, right, bottom))
            values = matrix @ encode(image)
            grouped = {}
            for index, source in enumerate(data['sources']):
                if source['group'] not in grouped or values[index] > grouped[source['group']]['score']:
                    grouped[source['group']] = {'sku': source['sku'], 'group': source['group'], 'score': float(values[index])}
            ranked = sorted(grouped.values(), key=lambda hit: -hit['score'])
            views.append({'kind': view['kind'], 'top': ranked[:5],
                'target': next((hit for hit in ranked if hit['group'] == row['expectedGroup']), None),
                'targetRank': next((index+1 for index, hit in enumerate(ranked) if hit['group'] == row['expectedGroup']), None)})
        results.append({'id': row['id'], 'expectedSku': row.get('expectedSku'), 'views': views})
        print(row['id'], flush=True)
    (root/'clip-diagnosis.json').write_text(json.dumps({
        'model': model.name, 'weightsSha256': CN_WEIGHTS_SHA256,
        'galleryHash': data['galleryHash'], 'queryManifestSha256': data['queryManifestSha256'],
        'seconds': time.perf_counter()-started, 'thresholdCalibrated': False, 'results': results}, indent=2)+'\n')


if __name__ == '__main__':
    main()
