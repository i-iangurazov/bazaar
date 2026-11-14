"""Freeze two public photographic cohorts before inference. No provider/DB calls."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import csv
import hashlib
import io
import json
from pathlib import Path
import time
import urllib.parse
import urllib.request
from PIL import Image

ROOT = Path('.local/product-photo-wide')
POLICY = Path('scripts/qa/fixtures/product-photo-wide-policy.json')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def fetch(url, limit=3_000_000):
    assert urllib.parse.urlsplit(url).hostname in ['datasets-server.huggingface.co', 'huggingface.co', 'raw.githubusercontent.com']
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Bazaar-local-evaluation/1.0'}), timeout=25) as response:
                data = response.read(limit+1)
            if len(data) > limit:
                raise ValueError('oversizedPublicAsset')
            return data
        except Exception:
            if attempt == 2:
                raise
            time.sleep(1+attempt)


def main(download):
    policy_bytes = POLICY.read_bytes()
    policy = json.loads(policy_bytes)
    target = ROOT/'manifest.json'
    if not download:
        manifest = json.loads(target.read_bytes())
        assert manifest['policySha256'] == digest(policy_bytes)
        for row in manifest['entries']:
            assert digest((ROOT/row['file']).read_bytes()) == row['sha256']
        print(json.dumps({'verifiedPhotos': len(manifest['entries']), 'network': False, 'inference': False}))
        return
    ROOT.mkdir(parents=True, exist_ok=True)
    (ROOT/'metadata').mkdir(exist_ok=True)
    (ROOT/'images').mkdir(exist_ok=True)
    seed = policy['seed']
    key = lambda value: digest((seed+':'+str(value)).encode())
    sop = policy['sources']['sop']
    meta = json.loads(fetch('https://huggingface.co/api/datasets/'+sop['dataset']))
    assert meta['sha'] == sop['revision']
    starts, start = {}, 0
    for category, count in sop['categoryImageCounts'].items():
        starts[category] = start
        start += count
    assert start == 60502

    def window(task):
        category, offset = task
        cache = ROOT/'metadata'/f'sop-{offset}.json'
        if cache.exists():
            data = cache.read_bytes()
        else:
            params = {'dataset': sop['dataset'], 'config': 'default', 'split': 'test', 'offset': offset, 'length': 100}
            data = fetch('https://datasets-server.huggingface.co/rows?'+urllib.parse.urlencode(params))
            cache.write_bytes(data)
        rows = json.loads(data)['rows']
        assert len(rows) == 100
        for value in rows:
            assert value['row']['category'] == category
            assert '/--/'+sop['revision']+'/' in value['row']['image']['src']
        return rows

    tasks = []
    for category, count in sop['categoryImageCounts'].items():
        middle = starts[category]+count//2
        tasks.extend([(category, middle-100), (category, middle)])
    with ThreadPoolExecutor(max_workers=4) as pool:
        windows = list(pool.map(window, tasks))
    groups = {}
    for values in windows:
        for value in values:
            row = value['row']
            groups.setdefault((row['category'], row['item_id']), []).append(value)
    entries, products = [], []
    for category in sop['categoryImageCounts']:
        eligible = sorted([identity for c, identity in groups if c == category and len(groups[(c, identity)]) >= 4], key=key)
        assert len(eligible) >= sop['knownPerCategory']+sop['absentPerCategory'], (category, len(eligible))
        for index, identity in enumerate(eligible[:sop['knownPerCategory']+sop['absentPerCategory']]):
            known = index < sop['knownPerCategory']
            product = 'sop-'+identity
            products.append({'id': product, 'name': 'SOP '+category+' '+identity, 'dataset': 'sop', 'category': category, 'known': known})
            rows = sorted(groups[(category, identity)], key=lambda value: value['row']['image_path'])
            for n, value in enumerate(rows[:4] if known else rows[2:4]):
                row = value['row']
                role = 'gallery' if known and n < 2 else 'query'
                entries.append({'id': f'sop-{identity}-{Path(row["image_path"]).stem}', 'productId': product,
                    'dataset': 'sop', 'category': category, 'known': known, 'role': role,
                    'sourceSplit': 'test', 'sourcePath': row['image_path'], 'viewerRow': value['row_idx'],
                    'file': f'images/sop-{identity}-{Path(row["image_path"]).stem}.jpg', '_url': row['image']['src']})
    print('SOP identities selected without inference', flush=True)
    grocery = policy['sources']['grocery']
    base = 'https://raw.githubusercontent.com/'+grocery['repository']+'/'+grocery['revision']+'/dataset/'
    blobs = {name: fetch(base+name) for name in ['classes.csv', 'train.txt', 'test.txt']}
    for name, data in blobs.items():
        (ROOT/'metadata'/('grocery-'+name)).write_bytes(data)
    classes = list(csv.DictReader(io.StringIO(blobs['classes.csv'].decode())))
    coarse = {}
    for row in classes:
        coarse.setdefault(row['Coarse Class ID (int)'], []).append(row['Class ID (int)'])
    unknown = {sorted(ids, key=key)[0] for ids in coarse.values() if len(ids) > 1}
    remaining = sorted([row['Class ID (int)'] for row in classes if row['Class ID (int)'] not in unknown], key=key)
    unknown.update(remaining[:grocery['absentClasses']-len(unknown)])
    assert len(unknown) == 27 and len(classes)-len(unknown) == 54
    splits = {}
    for split in ['train', 'test']:
        grouped = {}
        for line in blobs[split+'.txt'].decode().splitlines():
            path, fine, _ = [part.strip() for part in line.split(',')]
            grouped.setdefault(fine, []).append(path)
        splits[split] = grouped
    for row in classes:
        identity = row['Class ID (int)']
        known = identity not in unknown
        product = 'grocery-'+identity
        category = row['Coarse Class Name (str)']
        products.append({'id': product, 'name': row['Class Name (str)'].replace('-', ' '), 'dataset': 'grocery',
            'category': category, 'family': row['Iconic Image Path (str)'].split('/')[2], 'known': known})
        selection = [('test', path) for path in sorted(splits['test'][identity], key=key)[:3]]
        assert len(selection) == 3
        if known:
            selection += [('iconic', row['Iconic Image Path (str)'].lstrip('/'))]
            selection += [('train', path) for path in sorted(splits['train'][identity], key=key)[:2]]
        for split, path in selection:
            filename = product+'-'+split+'-'+Path(path).name
            entries.append({'id': filename, 'productId': product, 'dataset': 'grocery', 'category': category,
                'known': known, 'role': 'query' if split == 'test' else 'gallery', 'sourceSplit': split,
                'sourcePath': path, 'file': 'images/'+filename, '_url': base+urllib.parse.quote(path, safe='/')})

    def photo(row):
        path = ROOT/row['file']
        data = path.read_bytes() if path.exists() else fetch(row['_url'], 6_000_000)
        with Image.open(io.BytesIO(data)) as image:
            assert image.width*image.height <= 40_000_000
            rgb = image.convert('RGB')
            width, height = image.size
            pixels = digest(f'{width}x{height}:'.encode()+rgb.tobytes())
        path.write_bytes(data)
        clean = {k: v for k, v in row.items() if k != '_url'}
        return {**clean, 'sha256': digest(data), 'pixelSha256': pixels, 'bytes': len(data), 'width': width, 'height': height}

    with ThreadPoolExecutor(max_workers=4) as pool:
        frozen = list(pool.map(photo, entries))
    gallery_hashes = {row['pixelSha256'] for row in frozen if row['role'] == 'gallery'}
    excluded = [row for row in frozen if row['role'] == 'query' and row['pixelSha256'] in gallery_hashes]
    frozen = [row for row in frozen if row not in excluded]
    assert json.loads(fetch('https://huggingface.co/api/datasets/'+sop['dataset']))['sha'] == sop['revision']
    manifest = {'schema': 1, 'policySha256': digest(policy_bytes), 'preparedBeforeInference': True,
        'sourceRevisions': {'sop': sop['revision'], 'grocery': grocery['revision']},
        'products': products, 'entries': frozen, 'excludedExactGalleryQueryDuplicates': excluded}
    target.write_text(json.dumps(manifest, indent=2)+'\n')
    print(json.dumps({'products': len(products), 'photos': len(frozen), 'excludedDuplicates': len(excluded), 'manifestSha256': digest(target.read_bytes())}), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--download', action='store_true')
    main(parser.parse_args().download)
