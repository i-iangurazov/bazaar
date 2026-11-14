"""Run the two pinned local encoders on a frozen external photographic cohort."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', choices=['ppshitu', 'dinov2-224'])
    args = parser.parse_args()
    root = Path('.local/elfbar-independent').resolve()
    protocol_bytes = Path('scripts/qa/fixtures/elfbar-independent-evaluation.json').read_bytes()
    protocol = json.loads(protocol_bytes)
    digest = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
    for file, expected in protocol['sourceSha256'].items():
        assert digest(Path(file)) == expected, f'Changed evaluation source: {file}'
    if args.model is None:
        env = {key: os.environ[key] for key in ['PATH', 'HOME', 'TMPDIR', 'SYSTEMROOT'] if key in os.environ}
        env.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', HF_HUB_DISABLE_TELEMETRY='1',
            HF_HOME=str(root/'hf-cache'), TOKENIZERS_PARALLELISM='false',
            OMP_NUM_THREADS='1', OPENBLAS_NUM_THREADS='1', VECLIB_MAXIMUM_THREADS='1')
        for model in ['ppshitu', 'dinov2-224']:
            with (root/f'{model}.log').open('w') as log:
                subprocess.run([sys.executable, __file__, '--model', model], env=env,
                    stdout=log, stderr=log, check=True, timeout=600)
            print(f'Completed {model}', flush=True)
        return
    import numpy as np
    from elfbar_comparison import merged
    from elfbar_encoders import make_encoder, normalized
    from retrieval import RetrievalClient
    from run import ResourceMonitor, distribution
    inputs_path = root/'frozen-inputs.json'
    assert digest(inputs_path) == protocol['frozenInputSha256']
    data = json.loads(inputs_path.read_text())
    for key, path in [('policySha256', 'scripts/qa/fixtures/elfbar-independent-policy.json'),
                      ('manifestSha256', 'scripts/qa/fixtures/elfbar-independent-photos.json')]:
        assert data[key] == protocol[key] == digest(Path(path))
    assert data['modelManifestSha256'] == digest(Path('scripts/benchmarks/product-photo/elfbar-models.json'))
    assert data['storeId'] == 'photo-search-field-shop' and len(data['sources']) == 38
    for query in data['queries']:
        assert digest(root/query['file']) == query['sha256']
        for view in query['automaticViews']:
            assert digest(root/view['file']) == view['sha256']
    matrix = data['matrices'][args.model]
    assert digest(root/matrix['file']) == matrix['sha256']
    features = np.load(root/matrix['file'], allow_pickle=False)
    assert features.shape == (38, 512 if args.model == 'ppshitu' else 768)
    monitor = ResourceMonitor(); monitor.thread.start()
    executor = None
    try:
        with monitor.phase('model_load'):
            encoder = make_encoder(args.model, Path('.local/elfbar-model-comparison').resolve(), 1)
            executor = RetrievalClient(root, 1)
            executor.call('load', path=str(root/matrix['file']))
        with monitor.phase('warmup'):
            for _ in range(3):
                normalized(encoder, [root/data['queries'][0]['file']])
        rows, timings = [], []
        with monitor.phase('queries'):
            for query in data['queries']:
                started = time.perf_counter()
                vectors = np.concatenate([normalized(encoder, [root/view['file']]) for view in query['automaticViews']])
                elapsed = (time.perf_counter()-started)*1000
                matches = executor.call('search', vectors=vectors.tolist(), k=len(data['sources']))
                hits = merged(matches['scores'], matches['ids'], data['sources'])
                absent = merged(matches['scores'], matches['ids'], data['sources'], query['expectedId']) if query['expectedId'] else hits
                row = {key: query[key] for key in ['id', 'sha256', 'expectedId', 'expectedSku', 'expectedFlavor', 'reviewId', 'shootGroup', 'photographerGroup', 'scene', 'lighting', 'labelVisible', 'multiObject']}
                row.update(matches=hits, absentMatches=absent, encodeMs=elapsed, views=len(query['automaticViews']))
                rows.append(row); timings.append(elapsed)
                print(json.dumps({'model': args.model, 'query': query['id'], 'first': hits[0]['sku'], 'score': hits[0]['score']}), flush=True)
        result = {'schema': 1, 'model': args.model, 'protocolSha256': hashlib.sha256(protocol_bytes).hexdigest(),
            'frozenInputSha256': protocol['frozenInputSha256'], 'test': rows, 'phases': monitor.phases,
            'encodingMs': distribution(timings), 'device': 'cpu', 'threads': 1,
            'databaseWrites': False, 'runtimeChanged': False, 'privateFaiss': True}
        (root/f'{args.model}.json').write_text(json.dumps(result, indent=2)+'\n')
    finally:
        if executor:
            executor.close()
        monitor.stop.set(); monitor.thread.join(timeout=2)
        if monitor.failure:
            raise RuntimeError(monitor.failure)


if __name__ == '__main__':
    main()
