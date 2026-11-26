"""Send the paired-photo fixtures to a local compact service."""
import argparse
import base64
import http.client
import json
import math
import os
from pathlib import Path
import statistics
import struct
import time

MODEL = 'ppshitu-v2-pplcnetv2-v1-fp32-224'
RECORD_BYTES = 2052
MIN_SCORE = 0.68


def call(port, path, body=None, size=None, authenticated=True):
    connection = http.client.HTTPConnection('127.0.0.1', port, timeout=48)
    headers = {'Authorization': 'Bearer ' + os.environ['PRODUCT_PHOTO_SEARCH_TOKEN']} if authenticated else {}
    if body is not None:
        headers.update({'Content-Length': str(size), 'Content-Type': 'application/octet-stream'})
    try:
        connection.request('POST' if body is not None else 'GET', path, body=body, headers=headers)
        response = connection.getresponse()
        return response.status, json.loads(response.read(64 * 1024))
    finally:
        connection.close()


def prefix(case, count, root):
    jpeg = (root / case['jpeg']).read_bytes()
    value = {'count': count, 'imageBase64': base64.b64encode(jpeg).decode(), 'minScore': MIN_SCORE, **case['options']}
    data = json.dumps(value, separators=(',', ':')).encode()
    return struct.pack('<I', len(data)) + data


def verified(model):
    assert model.get('modelVersion') == MODEL
    assert model['analysis']['ocrStatus'] == 'ready'
    assert all(math.isfinite(item['score']) for item in model['matches'])


def accepted(reply, product_ids):
    return [product_ids[row['index']] for row in reply['matches'] if row['score'] >= MIN_SCORE]


def quality(port, sets, root):
    response_times, failures, differences = [], [], []
    metrics = {side: {'present': 0, 'top1': 0, 'top5': 0, 'absent': 0, 'absentWithCandidate': 0}
               for side in ('reference', 'compact')}
    for entry in sets:
        gallery = (root / entry['matrix']).read_bytes()
        assert len(gallery) == entry['count'] * RECORD_BYTES
        for case in entry['cases']:
            started = time.monotonic()
            pre = prefix(case, entry['count'], root)
            status, reply = call(port, '/search-stream', [pre, gallery], len(pre) + len(gallery))
            response_times.append(time.monotonic() - started)
            if status != 200:
                failures.append({'id': case['id'], 'status': status})
                continue
            verified(reply)
            reference = case['baseline']
            previous = accepted(reference, entry['productIds'])
            current = accepted(reply, entry['productIds'])
            expected = case['expectedProduct']
            for side, candidates in (('reference', previous), ('compact', current)):
                point = metrics[side]
                if expected:
                    point['present'] += 1
                    point['top1'] += candidates[:1] == [expected]
                    point['top5'] += expected in candidates[:5]
                else:
                    point['absent'] += 1
                    point['absentWithCandidate'] += bool(candidates)
            before, after = reference['analysis'], reply['analysis']
            region_changed = before['regionSource'] != after['regionSource']
            if before['region'] and after['region']:
                region_changed |= any(abs(before['region'][key] - after['region'][key]) > 0.002 for key in before['region'])
            texts_before = [line['text'] for line in before['lines']]
            texts_after = [line['text'] for line in after['lines']]
            if previous != current or region_changed or texts_before != texts_after:
                differences.append({'id': case['id'], 'visualOrderChanged': previous != current,
                                    'regionChanged': region_changed, 'ocrTextChanged': texts_before != texts_after,
                                    'before': texts_before, 'after': texts_after})
        print(entry['name'], len(entry['cases']), 'checked', flush=True)
    return {'cases': len(response_times), 'httpFailures': failures, 'differences': differences, 'metrics': metrics,
            'medianSeconds': statistics.median(response_times), 'maxSeconds': max(response_times)}


def large_gallery(port, root, entry):
    count = 63_499
    gallery = (root / entry['matrix']).read_bytes()
    case = next(item for item in entry['cases'] if item['baseline']['matches'][0]['score'] >= MIN_SCORE)
    match = case['baseline']['matches'][0]['index']
    winner = gallery[match*RECORD_BYTES:(match+1)*RECORD_BYTES]
    # Negative reference vectors fill the earlier rows; the only positive is last.
    positive = struct.unpack('<512f', winner[4:])
    filler = struct.pack('<I512f', 0, *(-x for x in positive))
    tail = struct.pack('<I', 1) + winner[4:]
    pre = prefix(case, count, root)

    def parts():
        yield pre
        block = filler * 1024
        full, remainder = divmod(count - 1, 1024)
        for _ in range(full):
            yield block
        yield filler * remainder
        yield tail

    start = time.monotonic()
    status, reply = call(port, '/search-stream', parts(), len(pre) + count * RECORD_BYTES)
    assert status == 200, (status, reply)
    verified(reply)
    assert reply['matches'][0]['index'] == count - 1 and reply['matches'][0]['score'] >= MIN_SCORE
    return {'rows': count, 'bytes': count * RECORD_BYTES, 'winner': count - 1, 'seconds': time.monotonic() - start}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, required=True)
    parser.add_argument('--fixtures', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    info = json.loads((args.fixtures / 'reference.json').read_text())
    assert info['model'] == MODEL
    status, health = call(args.port, '/health')
    assert status == 200 and health['ready'] and health['galleryProtocol'] == 'packed-f32-v1'
    assert call(args.port, '/health', authenticated=False)[0] == 401
    status, _ = call(args.port, '/search-stream', b'\x00\x00\x00\x00', 4)
    assert status == 400
    result = {'quality': quality(args.port, info['sets'], args.fixtures),
              'large': large_gallery(args.port, args.fixtures, info['sets'][0])}
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'cases': result['quality']['cases'], 'failures': result['quality']['httpFailures'],
                      'differences': len(result['quality']['differences']), 'large': result['large']}))


if __name__ == '__main__':
    main()
