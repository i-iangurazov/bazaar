from types import SimpleNamespace
import sys
import time
import unittest
from unittest.mock import Mock, patch

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


class LocalPhotoInferenceTest(unittest.TestCase):
    def test_releases_visual_weights_before_ranking_and_ocr_weights_after_failure(self):
        from local_photo_inference import LocalPhotoInference

        args = SimpleNamespace(model_dir=None, vision_model_dir=None, threads=1)
        reader = Mock()
        analysis = {'lines': []}
        reader.read.side_effect = [RuntimeError('failed read'), analysis]
        with (patch('local_photo_inference.CompactDetector'),
              patch('local_photo_inference.CompactEncoder'),
              patch('local_photo_inference.rank_stream'),
              patch('local_photo_inference.request_rgb'),
              patch('compact_vision.compact_text_reader', return_value=reader) as make_reader):
            inference = LocalPhotoInference(args)
            inference.rank(None, 0, [])
            self.assertIsNone(inference.detector)
            self.assertIsNone(inference.encoder)
            with self.assertRaisesRegex(RuntimeError, 'failed read'):
                inference.read_text({}, None, 'full')
            reader.ocr.slot.clear.assert_called_once()
            self.assertEqual(inference.read_text({}, None, 'full'), analysis)
            make_reader.assert_called_once()
            self.assertEqual(reader.ocr.slot.clear.call_count, 2)
