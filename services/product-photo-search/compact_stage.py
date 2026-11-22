"""One inference phase. The web process does not load any native model library."""
import argparse
import base64
import json
from pathlib import Path
import sys

import cv2

from compact_vision import CompactDetector, CompactEncoder, compact_text_reader
from engine import Encoder
from pipeline import describe_views
from stream_protocol import MAX_IMAGE_BYTES, MAX_HEADER_BYTES


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['embed', 'describe', 'ocr'])
    parser.add_argument('--model-dir', required=True, type=Path)
    parser.add_argument('--vision-model-dir', required=True, type=Path)
    parser.add_argument('--threads', type=int, choices=[1, 2, 4], default=1)
    args = parser.parse_args()
    cv2.setNumThreads(args.threads)
    try:
        request = json.loads(sys.stdin.buffer.read(MAX_HEADER_BYTES + 1))
        data = base64.b64decode(request['imageBase64'], validate=True)
        if not 0 < len(data) <= MAX_IMAGE_BYTES:
            raise ValueError('invalidImage')
        rgb = Encoder.decode(data)
        if args.action == 'ocr':
            reader = compact_text_reader(args.vision_model_dir, args.threads)
            result = {'analysis': reader.read(rgb, request.get('region'), request['source'])}
        else:
            encoder = CompactEncoder(args.model_dir, args.threads)
            if args.action == 'embed':
                result = {'embedding': encoder.encode_rgb(rgb).tolist()}
            else:
                region, auto = request.get('region'), request.get('autoRegion', True)
                detect = CompactDetector(args.model_dir, args.threads).detect if auto and not region else None
                regions, queries = describe_views(rgb, encoder, detect, region, auto)
                result = {'regions': regions, 'queries': queries}
    except (ValueError, TypeError, KeyError):
        result = {'error': 'invalidInput'}
    print(json.dumps(result, separators=(',', ':'), allow_nan=False))


if __name__ == '__main__':
    main()
