"""Extract only registered real frames. Supply public media locally; no login or download.

Usage: python scripts/qa/prepare-elfbar-field.py --ffmpeg /path/to/ffmpeg
Original media remain in ignored .local/elfbar-field-check. No color/lighting transforms.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ffmpeg', default='ffmpeg')
    args = parser.parse_args()
    root = Path('.local/elfbar-field-check').resolve()
    fixture = json.loads(Path('scripts/qa/fixtures/elfbar-photo-field.json').read_text())

    def local(name):
        path = (root/name).resolve()
        if not path.is_relative_to(root) or path == root:
            raise ValueError('invalidLocalPath')
        return path

    def digest(path):
        with path.open('rb') as stream:
            return hashlib.file_digest(stream, 'sha256').hexdigest()

    media = {row['id']: row for row in fixture['media']}
    for row in media.values():
        if digest(local(row['file'])) != row['sha256']:
            raise ValueError(f"changedMedia:{row['id']}")
    for row in fixture['gallery'] + fixture['queries']:
        source = media[row['media']]
        destination = local(row['file'])
        destination.parent.mkdir(parents=True, exist_ok=True)
        if source['kind'] == 'video':
            subprocess.run([args.ffmpeg, '-v', 'error', '-ss', str(row['seconds']),
                            '-i', str(local(source['file'])), '-frames:v', '1', '-vf', 'format=rgb24',
                            '-compression_level', '6', '-y', str(destination)], check=True)
        else:
            shutil.copyfile(local(source['file']), destination)
        if digest(destination) != row['sha256']:
            raise ValueError(f"changedFrame:{row['id']}")
    print(json.dumps({'verifiedMedia': len(media), 'queries': len(fixture['queries']),
                      'gallery': len(fixture['gallery']), 'inference': False}))


if __name__ == '__main__':
    main()
