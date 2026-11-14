"""Geometry and failure/isolation checks; model accuracy is evaluated separately."""
import unittest
from types import SimpleNamespace
import numpy as np
from vision import Vision, crop_region, valid_region


class VisionTest(unittest.TestCase):
    def test_normalized_regions_cannot_escape_the_input_or_create_tiny_crops(self):
        image = np.zeros((100, 200, 3), dtype=np.uint8)
        region = {'x': .25, 'y': .1, 'width': .5, 'height': .8}
        self.assertEqual(crop_region(image, region).shape, (80, 100, 3))
        for invalid in [None, [], region | {'x': -1}, region | {'width': float('nan')}, region | {'width': 2}, region | {'extra': True}, region | {'x': True}]:
            self.assertFalse(valid_region(invalid))
        with self.assertRaises(ValueError):
            crop_region(image, region | {'width': .001})

    def test_manual_region_overrides_detector_and_failed_ocr_never_reuses_previous_text(self):
        vision = Vision.__new__(Vision)
        vision.detector = SimpleNamespace(detect=lambda _: (_ for _ in ()).throw(AssertionError('must not detect')))
        vision.ocr = lambda _: SimpleNamespace(txts=['ICE MINT'], scores=[.99], boxes=np.array([[[1, 1], [20, 1], [20, 10], [1, 10]]]))
        region = {'x': .25, 'y': .1, 'width': .5, 'height': .8}
        image = np.zeros((100, 200, 3), dtype=np.uint8)
        _, first = vision.analyze(image, region)
        self.assertEqual(first['regionSource'], 'manual')
        self.assertEqual(first['lines'][0]['text'], 'ICE MINT')
        vision.ocr = lambda _: (_ for _ in ()).throw(RuntimeError('OCR unavailable'))
        _, second = vision.analyze(image, automatic=False)
        self.assertEqual(second, {'regionSource': 'full', 'region': None, 'ocrStatus': 'unavailable', 'lines': []})

    def test_several_similarly_strong_objects_do_not_silently_select_one(self):
        vision = Vision.__new__(Vision)
        region = {'x': 0, 'y': 0, 'width': .5, 'height': .5}
        vision.detector = SimpleNamespace(detect=lambda _: [(0.9, region), (0.88, region | {'x': .5})])
        vision.ocr = lambda _: SimpleNamespace(txts=None, scores=None, boxes=None)
        image = np.zeros((100, 200, 3), dtype=np.uint8)
        _, analysis = vision.analyze(image)
        self.assertEqual(analysis['regionSource'], 'full')
        self.assertIsNone(analysis['region'])


if __name__ == '__main__':
    unittest.main()
