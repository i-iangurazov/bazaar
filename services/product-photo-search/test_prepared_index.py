import hashlib
import json
from pathlib import Path
import struct
from tempfile import TemporaryDirectory
import unittest

from prepared_index import HEADER_BYTES, REFERENCE_BYTES, PreparedPhotoIndexes, SnapshotMissing
from stream_protocol import RECORD_BYTES


class PreparedPhotoIndexTests(unittest.TestCase):
    def test_validates_scope_revision_and_payload_before_reading_references(self):
        with TemporaryDirectory() as root:
            indexes = PreparedPhotoIndexes(Path(root), 'v1')
            request = {'organizationId': 'org', 'storeId': 'store', 'revision': 'a' * 64}
            scope = hashlib.sha256(b'["org","store"]').hexdigest()
            file = Path(root) / (scope + '.index')
            payload = bytes(RECORD_BYTES) + b'\x12' * REFERENCE_BYTES
            meta = json.dumps({**request, 'count': 1, 'withoutPhoto': 0, 'modelVersion': 'v1',
                               'sha256': hashlib.sha256(payload).hexdigest()}).encode()
            header = (struct.pack('<I', len(meta)) + meta).ljust(HEADER_BYTES, b'\0')
            file.write_bytes(header + payload)

            with indexes.open(request) as (data, info, identity):
                indexes.verify(data, identity)
                self.assertEqual(data.tell(), HEADER_BYTES)
                self.assertEqual(info['count'], 1)
                matches = [{'index': 0}]
                indexes.match_sources(data, 1, matches)
                self.assertEqual(matches[0]['sourceKey'], '12' * REFERENCE_BYTES)

            for change in ({'revision': 'b' * 64}, {'organizationId': 'other'}, {'storeId': 'other'}):
                with self.assertRaises(SnapshotMissing), indexes.open({**request, **change}):
                    self.fail('another scope or revision could read the index')

            file.write_bytes(header + b'x' + payload[1:])
            indexes.verified = None
            with self.assertRaisesRegex(RuntimeError, 'invalidSnapshotHash'), indexes.open(request) as (data, _, identity):
                indexes.verify(data, identity)
