"""Encoder comparison on frozen views, with predeclared rejection calibration."""
import argparse
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import platform
import time
os.environ.setdefault('OMP_NUM_THREADS', '1')
os.environ.setdefault('OPENBLAS_NUM_THREADS', '1')
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
from elfbar_encoders import make_encoder, normalized
from retrieval import RetrievalClient
from run import ResourceMonitor, distribution
from metrics import rejection_threshold
import numpy as np


def merged(scores, indexes, sources, exclude=None, limit=8):
    best = {}
    for row_scores, row_indexes in zip(scores, indexes):
        for score, index in zip(row_scores, row_indexes):
            source = sources[index]
            if source['productId'] == exclude:
                continue
            score = float(score)
            if not math.isfinite(score) or abs(score) > 1.001:
                raise ValueError('invalidSearchScore')
            hit = {'productId': source['productId'], 'sku': source['sku'], 'score': score, 'sourceIndex': index}
            previous = best.get(hit['productId'])
            if previous is None or score > previous['score'] or score == previous['score'] and index < previous['sourceIndex']:
                best[hit['productId']] = hit
    return sorted(best.values(), key=lambda hit: (-hit['score'], hit['sourceIndex']))[:limit]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', required=True)
    args = parser.parse_args()
    root = Path('.local/elfbar-model-comparison').resolve()
    protocol_bytes = Path('scripts/qa/fixtures/elfbar-model-comparison.json').read_bytes()
    protocol = json.loads(protocol_bytes)
    assert args.model in protocol['models']
    raw = (root/'frozen-inputs.json').read_bytes()
    assert hashlib.sha256(raw).hexdigest() == protocol['frozenInputSha256']
    assert hashlib.sha256(Path('scripts/benchmarks/product-photo/elfbar-models.json').read_bytes()).hexdigest() == protocol['modelManifestSha256']
    inputs = json.loads(raw)
    for scope in ['calibration', 'test']:
        for item in inputs[scope]['sources'] + inputs[scope]['queries']:
            assert hashlib.sha256((root/item['file']).read_bytes()).hexdigest() == item['sha256']
        for query in inputs[scope]['queries']:
            for item in query['automaticViews'] + query['manualViews']:
                assert hashlib.sha256((root/item['file']).read_bytes()).hexdigest() == item['sha256']
    out = root/'results'; out.mkdir(exist_ok=True)
    monitor = ResourceMonitor(); monitor.thread.start()
    executor = None
    timings = []
    try:
        with monitor.phase('model_load'):
            encoder = make_encoder(args.model, root, protocol['threads'])
            executor = RetrievalClient(root, protocol['threads'])
        with monitor.phase('warmup'):
            for _ in range(3):
                normalized(encoder, [root/inputs['calibration']['queries'][0]['file']])

        def evaluate(scope, name):
            sources = scope['sources']
            with monitor.phase(f'{name}_gallery'):
                vectors = np.concatenate([normalized(encoder, [root/source['file']]) for source in sources])
                if args.model == 'ppshitu':
                    assert np.allclose(vectors, np.array([source['ppEmbedding'] for source in sources]), atol=1e-5), 'PP gallery differs from application embeddings'
                path = root/f'{args.model}-{name}.npy'; np.save(path, vectors, allow_pickle=False)
                executor.call('load', path=str(path))
            rows = []
            with monitor.phase(f'{name}_queries'):
                for query in scope['queries']:
                    for mode in ['auto', 'manual']:
                        views = query['automaticViews' if mode == 'auto' else 'manualViews']
                        if not views:
                            continue
                        started = time.perf_counter()
                        features = np.concatenate([normalized(encoder, [root/view['file']]) for view in views])
                        encoded_ms = (time.perf_counter()-started)*1000
                        matches = executor.call('search', vectors=features.tolist(), k=len(sources))
                        hits = merged(matches['scores'], matches['ids'], sources)
                        absent = merged(matches['scores'], matches['ids'], sources, query['expectedId']) if query['expectedId'] else hits
                        row = {key: query.get(key) for key in ['id', 'expectedId', 'expectedSku', 'hard', 'multiObject', 'pose', 'scene', 'kind', 'sha256']}
                        row.update(mode=mode, views=len(views), encodeMs=encoded_ms, matches=hits, absentMatches=absent)
                        rows.append(row)
                        if name == 'test' and mode == 'auto':
                            timings.append(encoded_ms)
                        print(json.dumps({'model': args.model, 'split': name, 'id': query['id'], 'mode': mode, 'first': hits[0]['sku'], 'score': hits[0]['score']}), flush=True)
            return rows

        calibration = evaluate(inputs['calibration'], 'calibration')
        negatives = [row['absentMatches'][0]['score'] for row in calibration if row['mode'] == 'auto']
        assert len(negatives) == 11
        threshold = rejection_threshold(negatives, max_false_accept=protocol['calibration']['falseAcceptBudget'])
        frozen = {'model': args.model, 'threshold': threshold, 'calibrationNegativeTopScores': negatives,
            'policy': protocol['calibration'], 'protocolSha256': hashlib.sha256(protocol_bytes).hexdigest()}
        (out/f'{args.model}-calibration.json').write_text(json.dumps(frozen, indent=2)+'\n')
        # The threshold above is written before any field test encoder is invoked.
        test = evaluate(inputs['test'], 'test')
        if args.model == 'ppshitu':
            baseline = json.loads(Path('docs/benchmarks/product-photo-misses-20261114/approved38-results.json').read_text())
            for row in test:
                prior = next(value for value in baseline['results'] if value['query'] == row['id'] and value['mode'] == row['mode'])
                assert [hit['productId'] for hit in row['matches'] if hit['score'] >= .68] == [item['id'] for item in prior['items']], 'PP application prediction mismatch'
        result = {'schema': 1, 'model': args.model, 'description': encoder.name, 'weightsBytes': encoder.weights_bytes,
            'dimension': vectors_dimension(test, executor, root, args.model), 'threshold': threshold,
            'protocolSha256': hashlib.sha256(protocol_bytes).hexdigest(), 'inputSha256': protocol['frozenInputSha256'],
            'calibration': calibration, 'test': test, 'phases': monitor.phases,
            'autoEncodingMs': distribution(timings), 'threads': protocol['threads'], 'device': 'cpu',
            'platform': platform.platform(), 'versions': {name: importlib.metadata.version(name) for name in ['torch', 'torchvision', 'timm', 'numpy', 'faiss-cpu']},
            'resourceScope': 'Encoder process plus private Faiss child; CPU inference only; no detector/OCR/HTTP latency',
            'databaseWrites': False, 'runtimeChanged': False}
        (out/f'{args.model}.json').write_text(json.dumps(result, indent=2)+'\n')
    finally:
        if executor:
            executor.close()
        monitor.stop.set(); monitor.thread.join(timeout=2)
        if monitor.failure:
            raise RuntimeError(monitor.failure)


def vectors_dimension(test, executor, root, model):
    return int(np.load(root/f'{model}-test.npy', mmap_mode='r', allow_pickle=False).shape[1])


if __name__ == '__main__':
    main()
