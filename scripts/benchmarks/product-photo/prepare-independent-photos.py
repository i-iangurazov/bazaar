"""Verify the frozen public photo corpus; download only with explicit --download."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import urllib.parse
import urllib.request


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--download', action='store_true')
    args = parser.parse_args()
    root = Path('.local/elfbar-independent').resolve()
    corpus = json.loads(Path('scripts/qa/fixtures/elfbar-independent-photos.json').read_text())
    def verify(row):
        target = (root/row['file']).resolve()
        if not target.is_relative_to(root):
            raise ValueError('photoOutsideBenchmarkRoot')
        if target.exists():
            if target.stat().st_size != row['bytes'] or hashlib.sha256(target.read_bytes()).hexdigest() != row['sha256']:
                raise ValueError(f"changedPhoto:{row['id']}")
            return
        if not args.download:
            raise FileNotFoundError(f"Missing {row['id']}; supply frozen media or run --download")
        url = urllib.parse.urlsplit(row['url'])
        if url.scheme != 'https' or url.netloc != 'images.loox.io' or not url.path.startswith('/uploads/'):
            raise ValueError('unexpectedPhotoHost')
        request = urllib.request.Request(row['url'], headers={'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.loox.io/'})
        target.parent.mkdir(parents=True, exist_ok=True)
        partial = target.with_suffix('.part')
        try:
            with urllib.request.urlopen(request, timeout=30) as response, partial.open('wb') as output:
                remaining = row['bytes']
                while chunk := response.read(min(65536, remaining+1)):
                    remaining -= len(chunk)
                    if remaining < 0:
                        raise ValueError('oversizedPhoto')
                    output.write(chunk)
            if remaining != 0 or hashlib.sha256(partial.read_bytes()).hexdigest() != row['sha256']:
                raise ValueError('changedPhoto')
            partial.replace(target)
        finally:
            partial.unlink(missing_ok=True)
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(verify, corpus['queries']))
    print(json.dumps({'verifiedPhotos': len(corpus['queries']), 'downloadAllowed': args.download, 'inference': False}))


if __name__ == '__main__':
    main()
