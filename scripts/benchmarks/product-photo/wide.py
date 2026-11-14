"""Evaluate the frozen production-code PP/PicoDet/OCR pipeline. No tuning or DB."""
import base64
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

import numpy as np

ROOT = Path('.local/product-photo-wide')


def hard_pairs(rows, matrix, limit):
    candidates = {}
    scores = matrix@matrix.T
    for i, first in enumerate(rows):
        for j in range(i+1, len(rows)):
            second = rows[j]
            if first['productId'] == second['productId']:
                continue
            ids = tuple(sorted([first['productId'], second['productId']]))
            if ids not in candidates or float(scores[i, j]) > candidates[ids]['score']:
                candidates[ids] = {'productIds': ids, 'score': float(scores[i, j]), 'images': [first['id'], second['id']]}
    selected, used = [], set()
    for candidate in sorted(candidates.values(), key=lambda row: (-row['score'], row['productIds'])):
        if used.intersection(candidate['productIds']):
            continue
        selected.append(candidate)
        used.update(candidate['productIds'])
        if len(selected) == limit:
            break
    return selected


def main():
    sys.path.insert(0, str(Path('services/product-photo-search').resolve()))
    from engine import Encoder, MODEL_VERSION
    from retrieval import Searcher
    from pipeline import search_views
    from vision import Vision
    policy = json.loads(Path('scripts/qa/fixtures/product-photo-wide-policy.json').read_bytes())
    assert policy['model'] == MODEL_VERSION
    raw = (ROOT/'inputs.json').read_bytes()
    inputs = json.loads(raw)
    assert inputs['policySha256'] == hashlib.sha256(Path('scripts/qa/fixtures/product-photo-wide-policy.json').read_bytes()).hexdigest()
    assert inputs['manifestSha256'] == hashlib.sha256((ROOT/'manifest.json').read_bytes()).hexdigest()
    def photo(row):
        data = (ROOT/row['canonicalFile']).read_bytes()
        assert hashlib.sha256(data).hexdigest() == row['canonicalSha256']
        return data
    encoder = Encoder(Path('.local/product-photo-search/runtime/models/general_PPLCNetV2_base_pretrained_v1.0_infer'), 1)
    vision = Vision(Path('.local/product-photo-search/runtime/models/vision'), 1)
    searcher = Searcher(1)
    evidence = {'schema': 1, 'inputSha256': hashlib.sha256(raw).hexdigest(), 'policySha256': inputs['policySha256'],
        'modelAndThresholdUnchanged': True, 'threshold': policy['visualThreshold'], 'datasets': {}, 'results': []}
    rss_samples = []
    try:
        gallery = [row for row in inputs['entries'] if row['role'] == 'gallery']
        matrix = np.array([encoder.encode(photo(row)) for row in gallery], dtype='<f4')
        evidence['galleryScope'] = 'One mixed store; all known SOP listings and grocery fine classes'
        for dataset in ['sop', 'grocery']:
            queries = [row for row in inputs['entries'] if row['dataset'] == dataset and row['role'] == 'query']
            indexes = [i for i, row in enumerate(gallery) if row['dataset'] == dataset]
            pairs = hard_pairs([gallery[i] for i in indexes], matrix[indexes], policy['hardPairs']['countPerDataset'])
            hard = {identity for pair in pairs for identity in pair['productIds']}
            evidence['datasets'][dataset] = {'gallery': [{k: v for k, v in row.items() if k not in ['width', 'height', 'bytes']} for row in gallery], 'hardPairs': pairs}
            # Hard-pair selection is complete before this dataset's query encoding.
            (ROOT/f'{dataset}-gallery-protocol.json').write_text(json.dumps(evidence['datasets'][dataset], indent=2)+'\n')
            def run(row, absent=False):
                keep = [i for i, item in enumerate(gallery) if not absent or item['productId'] != row['productId']]
                selected = [gallery[i] for i in keep]
                group_map = {}
                groups = [group_map.setdefault(item['productId'], len(group_map)) for item in selected]
                payload = base64.b64encode(matrix[keep].tobytes()).decode()
                start = time.perf_counter()
                result = search_views(encoder.decode(photo(row)), encoder, searcher, payload, groups,
                    vision, automatic=True, min_score=policy['visualThreshold'])
                return {'query': row['id'], 'dataset': dataset, 'category': row['category'],
                    'productId': row['productId'], 'known': row['known'] and not absent, 'counterfactual': absent,
                    'hard': row['productId'] in hard, 'ms': (time.perf_counter()-start)*1000,
                    'matches': [{**match, 'productId': selected[match['index']]['productId']} for match in result['matches']],
                    'analysis': result['analysis']}
            for n, row in enumerate(queries):
                evidence['results'].append(run(row))
                if row['known'] and row['productId'] in hard:
                    evidence['results'].append(run(row, True))
                if n % 25 == 0:
                    rss = subprocess.check_output(['ps', '-o', 'rss=', '-p', f'{os.getpid()},{searcher.process.pid}'], text=True)
                    rss_samples.append(sum(int(value) for value in rss.split()))
                    (ROOT/'native-partial.json').write_text(json.dumps(evidence)+'\n')
                    print(json.dumps({'dataset': dataset, 'completedQueries': n+1, 'totalQueries': len(queries)}), flush=True)
        evidence['sampledCombinedPeakRssMiB'] = max(rss_samples)/1024
        evidence['rssMeasurement'] = 'Sampled combined parent/native-Faiss RSS; local Mac, one thread. Not server capacity.'
        (ROOT/'native.json').write_text(json.dumps(evidence, indent=2)+'\n')
    finally:
        searcher.close()


if __name__ == '__main__':
    main()
