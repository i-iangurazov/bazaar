"""Local gallery ablation on frozen photographs; no database or provider writes."""
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


def main():
    root = Path('.local/elfbar-pp-improve')
    oldroot = Path('.local/elfbar-model-comparison')
    previous_bytes = (oldroot/'frozen-inputs.json').read_bytes()
    previous = json.loads(previous_bytes)
    protocol = json.loads(Path('scripts/qa/fixtures/elfbar-model-comparison.json').read_text())
    assert hashlib.sha256(previous_bytes).hexdigest() == protocol['frozenInputSha256']
    freshroot = Path('.local/elfbar-independent')
    fresh = json.loads((freshroot/'frozen-inputs.json').read_text())
    frozen = json.loads(Path('scripts/qa/fixtures/elfbar-independent-evaluation.json').read_text())
    assert hashlib.sha256((freshroot/'frozen-inputs.json').read_bytes()).hexdigest() == frozen['frozenInputSha256']
    references = json.loads(Path('scripts/qa/fixtures/elfbar-miami-references.json').read_text())
    for asset in references['assets']:
        assert hashlib.sha256((root/'canonical'/asset['file']).read_bytes()).hexdigest() == asset['canonicalSha256']
    encoder = Encoder(Path('.local/product-photo-search/runtime/models/general_PPLCNetV2_base_pretrained_v1.0_infer'), 1)
    searcher = Searcher(1)
    try:
        vector = encoder.encode((root/'canonical/miami-three-quarter.jpg').read_bytes())
        detail = encoder.encode((root/'canonical/miami-front-detail.jpg').read_bytes())
        sources = previous['test']['sources']
        assert sources[12]['sku'] == 'QA-ELFBAR-FIELD-STRAWBERRY-BANANA'
        for index, removal in zip([12, 13], references['removeReferences']):
            assert sources[index]['sourceKey'] == removal['sourceKey']
            assert sources[index]['sha256'] == removal['canonicalSha256']
        miami = next(s['productId'] for s in sources if s['sku'] == 'PHOTO-ELFBAR-TEST')
        reference = {'productId': miami, 'sku': 'PHOTO-ELFBAR-TEST'}
        original = np.array([s['ppEmbedding'] for s in sources], dtype=np.float32)
        variants = {'original38': (original, sources),
            'addMiami39': (np.concatenate([original, vector[None]]), sources+[reference]),
            'replaceDisplay38': (np.concatenate([np.delete(original, 12, axis=0), vector[None]]), [s for i, s in enumerate(sources) if i != 12]+[reference]),
            'frontAndBody40': (np.concatenate([original, vector[None], detail[None]]), sources+[reference, reference]),
            'replaceTwoDisplays38': (np.concatenate([np.delete(original, [12, 13], axis=0), vector[None], detail[None]]), [s for i, s in enumerate(sources) if i not in [12, 13]]+[reference, reference])}
        cases = []
        for split, base, queries in [('development', oldroot, previous['test']['queries']), ('independent', freshroot, fresh['queries'])]:
            for query in queries:
                for view in query['automaticViews']:
                    assert hashlib.sha256((base/view['file']).read_bytes()).hexdigest() == view['sha256']
                vectors = [encoder.encode_rgb(cv2.cvtColor(cv2.imread(str(base/view['file'])), cv2.COLOR_BGR2RGB)).tolist() for view in query['automaticViews']]
                cases.append((split, query, vectors))
        result = []
        for name, (matrix, items) in variants.items():
            groupmap, groups = {}, []
            for source in items:
                groupmap.setdefault(source['productId'], len(groupmap)); groups.append(groupmap[source['productId']])
            for split, query, vectors in cases:
                batches = searcher.search_many(base64.b64encode(matrix.astype('<f4').tobytes()).decode(), groups, vectors)
                best = {}
                for batch in batches:
                    for match in batch:
                        source = items[match['index']]; key = source['productId']
                        if key not in best or match['score'] > best[key]['score']:
                            best[key] = {'productId': key, 'sku': source['sku'], 'score': match['score']}
                hits = sorted(best.values(), key=lambda hit: -hit['score'])
                result.append({'variant': name, 'split': split, 'query': query['id'], 'expectedId': query['expectedId'],
                    'multiObject': query.get('multiObject', False), 'hits': hits, 'items': [hit for hit in hits if hit['score'] >= .68],
                    'absentItems': [hit for hit in hits if hit['score'] >= .68 and hit['productId'] != query['expectedId']]})
        (root/'gallery-ablation.json').write_text(json.dumps(result, indent=2)+'\n')
        for name in variants:
            for split in ['development', 'independent']:
                rows = [r for r in result if r['variant'] == name and r['split'] == split and not r['multiObject']]
                known = [r for r in rows if r['expectedId']]; unknown = [r for r in rows if not r['expectedId']]
                print(json.dumps({'variant': name, 'split': split, 'known': len(known),
                    'correct': sum(bool(r['items'] and r['items'][0]['productId'] == r['expectedId']) for r in known),
                    'wrong': sum(bool(r['items'] and r['items'][0]['productId'] != r['expectedId']) for r in known),
                    'absent': len(unknown), 'false': sum(bool(r['items']) for r in unknown)}), flush=True)
    finally:
        searcher.close()


if __name__ == '__main__':
    main()
