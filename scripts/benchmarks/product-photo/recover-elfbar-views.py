"""One bounded reference experiment. Offline PP/Faiss; new holdout is never indexed."""
import base64
import hashlib
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path('services/product-photo-search').resolve()))
import cv2
import numpy as np
from engine import Encoder
from retrieval import Searcher
from vision import Vision, crop_region


def verified(root, relative, digest):
    path = (root/relative).resolve()
    if not path.is_relative_to(root.resolve()):
        raise ValueError('outsideExperiment')
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != digest:
        raise ValueError('changedExperimentInput')
    return data


def main():
    root = Path('.local/elfbar-recovery-v2')
    fixture_bytes = Path('scripts/qa/fixtures/elfbar-recovery-v2.json').read_bytes()
    fixture = json.loads(fixture_bytes)
    previous_root = Path('.local/elfbar-model-comparison')
    previous_protocol = json.loads(Path('scripts/qa/fixtures/elfbar-model-comparison.json').read_text())
    previous = json.loads(verified(previous_root, 'frozen-inputs.json', previous_protocol['frozenInputSha256']))
    external_root = Path('.local/elfbar-independent')
    external_protocol = json.loads(Path('scripts/qa/fixtures/elfbar-independent-evaluation.json').read_text())
    external = json.loads(verified(external_root, 'frozen-inputs.json', external_protocol['frozenInputSha256']))
    mint = json.loads(Path('scripts/qa/fixtures/elfbar-miami-references.json').read_text())
    encoder = Encoder(Path('.local/product-photo-search/runtime/models/general_PPLCNetV2_base_pretrained_v1.0_infer'), 1)
    vision = Vision(Path('.local/product-photo-search/runtime/models/vision'), 1)
    searcher = Searcher(1)
    try:
        old = previous['test']['sources']
        for index, excluded in zip([12, 13], mint['removeReferences']):
            assert old[index]['sourceKey'] == excluded['sourceKey']
            assert old[index]['sha256'] == excluded['canonicalSha256']
        miami = next(row['productId'] for row in old if row['sku'] == 'PHOTO-ELFBAR-TEST')
        current = [row for i, row in enumerate(old) if i not in [12, 13]]
        for asset in mint['assets']:
            data = verified(Path('.local/elfbar-pp-improve'), 'canonical/'+asset['file'], asset['canonicalSha256'])
            current.append({'productId': miami, 'sku': asset['sku'], 'ppEmbedding': encoder.encode(data).tolist()})
        rear = fixture['reference']
        data = verified(root, 'canonical/'+rear['file'], rear['canonicalSha256'])
        rear_row = {'productId': miami, 'sku': rear['sku'], 'ppEmbedding': encoder.encode(data).tolist()}
        variants = {'current38': current, 'miamiRear39': current+[rear_row],
                    'restoreDisplay39': current+[old[12]], 'rearAndDisplay40': current+[rear_row, old[12]]}
        assert list(variants) == fixture['variants']
        queries = []
        for split, base, rows in [('field', previous_root, previous['test']['queries']),
                                  ('external', external_root, external['queries'])]:
            for row in rows:
                vectors = []
                for view in row['automaticViews']:
                    pixels = cv2.imdecode(np.frombuffer(verified(base, view['file'], view['sha256']), np.uint8), cv2.IMREAD_COLOR)
                    vectors.append(encoder.encode_rgb(cv2.cvtColor(pixels, cv2.COLOR_BGR2RGB)).tolist())
                queries.append((split, row, vectors))
        # New data is encoded only after the four variants/threshold/acceptance are fixed.
        holdout_views = []
        for row in fixture['holdoutQueries']:
            verified(root, row['file'], row['sha256'])
            data = verified(root, row['canonicalFile'], row['canonicalSha256'])
            rgb = encoder.decode(data)
            regions = [None]+[region for _, region in vision.propose(rgb)[:5]]
            vectors = [encoder.encode_rgb(crop_region(rgb, region) if region else rgb).tolist() for region in regions]
            queries.append(('new-holdout', {**row, 'expectedId': None}, vectors))
            holdout_views.append({'query': row['id'], 'regions': regions})
        results = []
        for name, items in variants.items():
            matrix = np.array([item['ppEmbedding'] for item in items], dtype='<f4')
            payload = base64.b64encode(matrix.tobytes()).decode()
            group_map = {}
            groups = [group_map.setdefault(item['productId'], len(group_map)) for item in items]
            for split, query, vectors in queries:
                best = {}
                for matches in searcher.search_many(payload, groups, vectors):
                    for match in matches:
                        source = items[match['index']]
                        key = source['productId']
                        if key not in best or match['score'] > best[key]['score']:
                            best[key] = {'productId': key, 'sku': source['sku'], 'score': match['score']}
                hits = sorted(best.values(), key=lambda item: -item['score'])
                results.append({'variant': name, 'split': split, 'query': query['id'],
                    'expectedId': query['expectedId'], 'multiObject': query.get('multiObject', False),
                    'hits': hits, 'items': [hit for hit in hits if hit['score'] >= fixture['threshold']]})
        summary = []
        for name in variants:
            for split in ['field', 'external', 'new-holdout']:
                rows = [r for r in results if r['variant'] == name and r['split'] == split and not r['multiObject']]
                known, absent = [r for r in rows if r['expectedId']], [r for r in rows if not r['expectedId']]
                summary.append({'variant': name, 'split': split, 'known': len(known),
                    'correctFirst': sum(bool(r['items'] and r['items'][0]['productId'] == r['expectedId']) for r in known),
                    'wrongFirst': sum(bool(r['items'] and r['items'][0]['productId'] != r['expectedId']) for r in known),
                    'absent': len(absent), 'absentWithCandidates': sum(bool(r['items']) for r in absent)})
        evidence = {'schema': 1, 'protocolSha256': hashlib.sha256(fixture_bytes).hexdigest(),
            'newHoldoutUsedAsReference': False, 'thresholdRetuned': False,
            'newHoldoutViews': holdout_views, 'summary': summary, 'results': results}
        (root/'reference-experiment.json').write_text(json.dumps(evidence, indent=2)+'\n')
        for row in summary:
            print(json.dumps(row), flush=True)
    finally:
        searcher.close()


if __name__ == '__main__':
    main()
