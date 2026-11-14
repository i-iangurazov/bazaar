"""Read-only score audit. Known cases, not a held-out accuracy evaluation.

NumPy dot products expose unthresholded scores against the exported authorized
gallery; production search continues to use Faiss. Pixel rotations use NumPy's
lossless quarter turns, never generated reference/query photographs.
"""
import hashlib
import json
import os
from pathlib import Path
import sys
os.environ.setdefault('OMP_NUM_THREADS', '1')
os.environ.setdefault('OPENBLAS_NUM_THREADS', '1')
sys.path.insert(0, str(Path('services/product-photo-search').resolve()))
import cv2
import numpy as np
from engine import Encoder
from vision import Vision, crop_region


def main():
    root = Path('.local/elfbar-misses')
    data = json.loads((root/'input.json').read_text())
    encoder = Encoder(Path('.local/product-photo-search/runtime/models/general_PPLCNetV2_base_pretrained_v1.0_infer'), 1)
    vision = Vision(Path('.local/product-photo-search/runtime/models/vision'), 1)
    matrix = np.array([row['embedding'] for row in data['sources']], np.float32)
    sources = data['sources']

    def scores(pixels, group):
        vector = encoder.encode_rgb(pixels)
        values = matrix @ vector
        order = np.argsort(-values, kind='stable')
        top, seen = [], set()
        for index in order:
            source = sources[index]
            if source['group'] in seen:
                continue
            seen.add(source['group'])
            top.append({'group': source['group'], 'sku': source['sku'], 'score': float(values[index]), 'sourceIndex': int(index)})
        target = next((row for row in top if row['group'] == group), None)
        return {'top': top[:5], 'target': target, 'targetRank': next((index+1 for index, row in enumerate(top) if row['group'] == group), None)}

    def audit(row, path, quality):
        image = cv2.cvtColor(cv2.imread(str(path)), cv2.COLOR_BGR2RGB) if str(path).endswith('.png') else encoder.decode(Path(path).read_bytes())
        proposals = vision.propose(image)
        regions = [('full', None, None)] + [(f'detection-{i}', box, score) for i, (score, box) in enumerate(proposals)]
        regions += [('manual', row['region'], None)] if row.get('region') else []
        regions += [('oracle', row['oracleRegion'], None)] if row.get('oracleRegion') else []
        views = []
        for kind, region, confidence in regions:
            pixels = crop_region(image, region) if region else image
            turns = []
            for k in range(4):
                rotated = np.ascontiguousarray(np.rot90(pixels, k)) if k else pixels
                turns.append({'quarterTurns': k, **scores(rotated, row['expectedGroup'])})
            views.append({'kind': kind, 'region': region, 'detectionConfidence': confidence,
                'pixels': [pixels.shape[1], pixels.shape[0]], 'laplacianVariance': float(cv2.Laplacian(cv2.cvtColor(pixels, cv2.COLOR_RGB2GRAY), cv2.CV_64F).var()), 'turns': turns})
        ocr = vision.read(image, row.get('oracleRegion') or row.get('region'), 'manual') if row.get('oracleRegion') else None
        return {'quality': quality, 'imagePixels': [image.shape[1], image.shape[0]], 'views': views, 'oracleOCR': ocr}

    results = []
    for row in data['queries']:
        assert hashlib.sha256(Path(row['file']).read_bytes()).hexdigest() == row['sha256']
        low = audit(row, row['file'], 'frozen-low-resolution')
        high = audit(row, row['highFile'], 'same-timestamp-higher-source-resolution') if row.get('highFile') else None
        original = None
        if row.get('originalFrameFile'):
            assert hashlib.sha256(Path(row['originalFrameFile']).read_bytes()).hexdigest() == row['originalFrameSha256']
            original = audit(row, row['originalFrameFile'], 'original-1080p-frame-before-ingress-downscale')
        results.append({'id': row['id'], 'expectedSku': row.get('expectedSku'), 'multiObject': bool(row.get('multiObject')), 'inputSha256': row['inputSha256'], 'low': low, 'high': high, 'original': original})
        auto = [turn for view in low['views'] if view['kind'].startswith(('full', 'detection-')) for turn in view['turns']]
        best = max(auto, key=lambda turn: turn['target']['score'] if turn['target'] else -1)
        print(json.dumps({'id': row['id'], 'rotationOracleTargetScore': best['target']['score'] if best['target'] else None}), flush=True)
    # Do not store the embedding matrix in review evidence.
    evidence = {key: data[key] for key in ['schema', 'storeId', 'queryManifestSha256', 'oracleManifestSha256', 'galleryManifestSha256', 'galleryHash']}
    evidence['sources'] = [{key: source[key] for key in ['productId', 'sku', 'sourceKey', 'sourceUrl', 'group', 'sha256']} for source in sources]
    evidence['results'] = results
    (root/'diagnosis.json').write_text(json.dumps(evidence, indent=2)+'\n')


if __name__ == '__main__':
    main()
