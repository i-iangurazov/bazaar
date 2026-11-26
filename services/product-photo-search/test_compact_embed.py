from types import SimpleNamespace
import sys
import time
import unittest
from unittest.mock import patch

from compact_server import EmbedWorker


FAKE_STAGE = """
import json
import os
import struct
import sys
import time

while prefix := sys.stdin.buffer.read(4):
    size, = struct.unpack('<I', prefix)
    image = json.loads(sys.stdin.buffer.read(size))['imageBase64']
    if image == 'timeout':
        time.sleep(10)
    result = {'error': 'invalidInput'} if image == 'invalid' else {'image': image, 'pid': os.getpid()}
    body = json.dumps(result).encode()
    sys.stdout.buffer.write(struct.pack('<I', len(body)) + body)
    sys.stdout.buffer.flush()
"""


class EmbedWorkerTest(unittest.TestCase):
    def setUp(self):
        self.worker = EmbedWorker(SimpleNamespace(threads=1))
        self.addCleanup(self.worker.close)
        command = patch('compact_server.stage_command', return_value=[sys.executable, '-c', FAKE_STAGE])
        command.start()
        self.addCleanup(command.stop)

    def embed(self, image, timeout=2):
        return self.worker.embed({'imageBase64': image}, time.monotonic() + timeout)

    def test_reuses_encoder_and_recovers_from_bad_image(self):
        first = self.embed('first')
        with self.assertRaises(ValueError):
            self.embed('invalid')
        self.assertEqual(self.embed('second'), {'image': 'second', 'pid': first['pid']})
        self.worker.close()
        self.assertIsNone(self.worker.process)

    def test_timed_out_encoder_cannot_answer_next_request(self):
        first = self.embed('first')
        process = self.worker.process
        with self.assertRaises(TimeoutError):
            self.embed('timeout', timeout=0.1)
        self.assertIsNotNone(process.poll())
        self.assertIsNone(self.worker.process)
        second = self.embed('second')
        self.assertEqual(second['image'], 'second')
        self.assertNotEqual(second['pid'], first['pid'])
