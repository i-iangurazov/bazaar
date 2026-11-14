"""Real HTTP/model smoke inside the network-isolated disposable Linux container."""
import base64
from concurrent.futures import ThreadPoolExecutor
import hashlib
import http.client
import importlib.metadata
import json
import math
import os
from pathlib import Path
import platform
import signal
import struct
import threading
import time
import urllib.error
import urllib.request

ROOT = Path('/qa-data')
TOKEN = os.environ['PRODUCT_PHOTO_SEARCH_TOKEN']
BASE = 'http://127.0.0.1:3150'
MODEL = 'ppshitu-v2-pplcnetv2-v1-fp32-224'


def call(path, body=None, authorized=True):
    headers = {'Content-Type': 'application/json'}
    if authorized:
        headers['Authorization'] = 'Bearer '+TOKEN
    request = urllib.request.Request(BASE+path, data=None if body is None else json.dumps(body).encode(), headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        return error.code, json.load(error)


def main():
    assert platform.system() == 'Linux' and platform.machine() == 'x86_64'
    fixture = json.loads((ROOT/'fixture.json').read_text())
    for row in fixture['images']:
        assert hashlib.sha256((ROOT/row['file']).read_bytes()).hexdigest() == row['sha256']
    assert call('/health', authorized=False)[0] == 401
    code, health = call('/health')
    assert code == 200 and health == {'modelVersion': MODEL, 'dimension': 512, 'ready': True, 'vision': True}
    assert call('/embed', {'imageBase64': base64.b64encode(b'not a raster').decode()})[0] == 400
    photo = lambda row: base64.b64encode((ROOT/row['file']).read_bytes()).decode()
    gallery = [row for row in fixture['images'] if row['role'] == 'gallery']
    vectors = []
    for row in gallery:
        code, result = call('/embed', {'imageBase64': photo(row)})
        assert code == 200 and result['modelVersion'] == MODEL
        vector = result['embedding']
        assert len(vector) == 512 and all(math.isfinite(x) for x in vector)
        assert abs(math.sqrt(sum(x*x for x in vector))-1) < .001
        vectors.append(vector)
    raw = b''.join(struct.pack('<512f', *vector) for vector in vectors)
    identities = list(dict.fromkeys(row['productId'] for row in gallery))
    groups = [identities.index(row['productId']) for row in gallery]
    request = {'imageBase64': photo(gallery[0]), 'vectorsBase64': base64.b64encode(raw).decode(), 'groups': groups, 'minScore': .68}
    for patch in [{'vectorsBase64': 'broken'}, {'groups': []}, {'region': {'x': -1, 'y': 0, 'width': 1, 'height': 1}}, {'minScore': None}, {'autoRegion': 'yes'}]:
        assert call('/search', {**request, **patch})[0] == 400
    outcomes = []
    for row in fixture['images']:
        if row['role'] != 'query':
            continue
        start = time.perf_counter()
        code, result = call('/search', {**request, 'imageBase64': photo(row)})
        assert code == 200 and result['modelVersion'] == MODEL
        assert result['analysis']['ocrStatus'] == 'ready'
        assert all(0 <= match['index'] < len(gallery) for match in result['matches'])
        first = result['matches'][0]
        # ALOI is a fixed positive compatibility control; grocery results are
        # recorded without claiming this small fixture estimates search quality.
        if row['productId'].startswith('aloi-'):
            assert gallery[first['index']]['productId'] == row['productId'] and first['score'] > .68
        outcomes.append({'query': row['id'], 'first': gallery[first['index']]['productId'],
            'firstScore': first['score'], 'ocrLines': len(result['analysis']['lines']), 'regionSource': result['analysis']['regionSource'],
            'ms': (time.perf_counter()-start)*1000})
    # A new one-row scope cannot return indexes/data from the previous gallery.
    one = {**request, 'vectorsBase64': base64.b64encode(raw[:2048]).decode(), 'groups': [0], 'autoRegion': False}
    assert [m['index'] for m in call('/search', one)[1]['matches']] == [0]
    region = {'x': 0, 'y': 0, 'width': 1, 'height': 1}
    code, manual = call('/search', {**one, 'region': region})
    assert code == 200 and manual['analysis']['regionSource'] == 'manual' and manual['analysis']['region'] == region
    start = time.perf_counter()
    code, large = call('/search', {**one, 'vectorsBase64': base64.b64encode(raw[:2048]*10_000).decode(), 'groups': list(range(10_000))})
    large_ms = (time.perf_counter()-start)*1000
    assert code == 200 and len(large['matches']) == 8 and large_ms < 20_000
    barrier = threading.Barrier(6)
    def concurrent(_):
        barrier.wait()
        return call('/search', request)[0]
    with ThreadPoolExecutor(max_workers=6) as pool:
        concurrent_statuses = list(pool.map(concurrent, range(6)))
    assert 200 in concurrent_statuses and 429 in concurrent_statuses and set(concurrent_statuses) <= {200, 429}
    # A stalled input must expire and release capacity, rather than wedging all stores.
    connection = http.client.HTTPConnection('127.0.0.1', 3150, timeout=15)
    connection.putrequest('POST', '/embed')
    for key, value in {'Authorization': 'Bearer '+TOKEN, 'Content-Type': 'application/json', 'Content-Length': '100'}.items():
        connection.putheader(key, value)
    connection.endheaders(b'{')
    start = time.perf_counter()
    assert connection.getresponse().status == 400
    body_timeout_ms = (time.perf_counter()-start)*1000
    connection.close()
    assert 8_000 < body_timeout_ms < 15_000 and call('/search', one)[0] == 200
    children = []
    for proc in Path('/proc').glob('[0-9]*/cmdline'):
        try:
            args = proc.read_bytes().split(b'\0')
            if any(arg.endswith(b'/retrieval.py') for arg in args):
                children.append(int(proc.parent.name))
        except (FileNotFoundError, PermissionError):
            pass
    assert len(children) == 1
    os.kill(children[0], signal.SIGKILL)
    for _ in range(30):
        if not call('/health')[1]['ready']:
            break
        time.sleep(.05)
    assert not call('/health')[1]['ready']
    assert call('/search', one)[0] == 503
    assert call('/search', one)[0] == 200 and call('/health')[1]['ready']
    peak = Path('/sys/fs/cgroup/memory.peak')
    result = {'schema': 1, 'platform': platform.platform(), 'python': platform.python_version(),
        'versions': {name: importlib.metadata.version(name) for name in ['paddlepaddle', 'faiss-cpu', 'rapidocr', 'onnxruntime', 'numpy', 'opencv-python']},
        'realModels': True, 'ocrReady': True, 'unauthorized401': True, 'invalidInputs400': True,
        'manualRegion': True, 'scopeReplacement': True, 'vectors10000Ms': large_ms,
        'concurrentStatuses': concurrent_statuses, 'bodyTimeoutMs': body_timeout_ms,
        'recoveryAfterTimeout': True, 'faissCrashDetectedAndRecovered': True,
        'containerPeakMemoryMiB': int(peak.read_text())/1024**2 if peak.exists() else None,
        'outcomes': outcomes, 'purpose': fixture['purpose']}
    assert TOKEN not in json.dumps(result)
    print(json.dumps(result))


if __name__ == '__main__':
    main()
