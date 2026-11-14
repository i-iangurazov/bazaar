"""Run encoders sequentially, offline, without provider credentials in workers."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--models', nargs='+')
    args = parser.parse_args()
    root = Path('.local/elfbar-model-comparison')
    protocol = json.loads(Path('scripts/qa/fixtures/elfbar-model-comparison.json').read_text())
    selected = args.models or protocol['models']
    assert set(selected).issubset(protocol['models'])
    env = {key: os.environ[key] for key in ['PATH', 'HOME', 'TMPDIR', 'SYSTEMROOT'] if key in os.environ}
    env.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', HF_HUB_DISABLE_TELEMETRY='1',
        HF_HOME=str((root/'hf-cache').resolve()), TOKENIZERS_PARALLELISM='false',
        OMP_NUM_THREADS='1', OPENBLAS_NUM_THREADS='1', VECLIB_MAXIMUM_THREADS='1')
    for model in selected:
        print(f'Starting {model}', flush=True)
        with (root/f'{model}.log').open('w') as log:
            subprocess.run([sys.executable, 'scripts/benchmarks/product-photo/elfbar_comparison.py', '--model', model],
                env=env, stdout=log, stderr=log, check=True, timeout=900)
        print(f'Completed {model}', flush=True)


if __name__ == '__main__':
    main()
