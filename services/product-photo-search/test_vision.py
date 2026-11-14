"""Geometry and failure/isolation checks; model accuracy is evaluated separately."""
import unittest
from types import SimpleNamespace
import numpy as np
from vision import Detector, Vision, crop_region, valid_region


class VisionTest(unittest.TestCase):
    def test_context_retry_uses_only_text_inside_the_automatic_product_region(self):
        vision = Vision.__new__(Vision)
        region = {'x': .25, 'y': .2, 'width': .5, 'height': .6}
        calls = []
        def read(image, box, source):
            calls.append(source)
            lines = [{'text': 'ELFBAR', 'confidence': .99, 'box': {'x': .1, 'y': .1, 'width': .5, 'height': .1}}]
            if source == 'full':
                lines = [{'text': 'MIAMI MINT', 'confidence': .9, 'box': {'x': .3, 'y': .5, 'width': .3, 'height': .1}},
                    {'text': 'ICE MINT', 'confidence': .99, 'box': {'x': 0, 'y': 0, 'width': .2, 'height': .1}}]
            return {'regionSource': source, 'region': box, 'ocrStatus': 'ready', 'lines': lines}
        vision._read_once = read
        result = vision.read(np.zeros((100, 200, 3)), region, 'auto')
        self.assertEqual(calls, ['auto', 'full'])
        self.assertEqual([line['text'] for line in result['lines']], ['MIAMI MINT'])
        self.assertEqual(result['region'], region)
        self.assertAlmostEqual(result['lines'][0]['box']['x'], .1)
        self.assertTrue(valid_region(result['lines'][0]['box']))

    def test_manual_and_already_readable_labels_never_trigger_context_retry(self):
        vision = Vision.__new__(Vision)
        calls = []
        def read(image, region, source):
            calls.append(source)
            return {'regionSource': source, 'region': region, 'ocrStatus': 'ready',
                'lines': [{'text': 'ICE MINT', 'confidence': .99, 'box': {'x': 0, 'y': 0, 'width': 1, 'height': 1}}]}
        vision._read_once = read
        region = {'x': .25, 'y': .2, 'width': .5, 'height': .6}
        for source in ['manual', 'auto']:
            result = vision.read(np.zeros((100, 200, 3)), region, source)
            self.assertEqual(result['regionSource'], source)
        self.assertEqual(calls, ['manual', 'auto'])

    def test_failed_context_retry_does_not_promote_outside_or_low_confidence_words(self):
        vision = Vision.__new__(Vision)
        region = {'x': .25, 'y': .2, 'width': .5, 'height': .6}
        def read(image, box, source):
            return {'regionSource': source, 'region': box, 'ocrStatus': 'ready',
                'lines': [] if source != 'full' else [{'text': 'MIAMI MINT', 'confidence': .7,
                    'box': {'x': .3, 'y': .5, 'width': .3, 'height': .1}}]}
        vision._read_once = read
        self.assertEqual(vision.read(np.zeros((100, 200, 3)), region, 'auto')['lines'], [])

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
        first = vision.read(image, region, 'manual')
        self.assertEqual(first['regionSource'], 'manual')
        self.assertEqual(first['lines'][0]['text'], 'ICE MINT')
        vision.ocr = lambda _: (_ for _ in ()).throw(RuntimeError('OCR unavailable'))
        second = vision.read(image)
        self.assertEqual(second, {'regionSource': 'full', 'region': None, 'ocrStatus': 'unavailable', 'lines': []})

    def test_proposals_are_preserved_for_recognition_and_detector_failure_falls_back(self):
        vision = Vision.__new__(Vision)
        region = {'x': 0, 'y': 0, 'width': .5, 'height': .5}
        vision.detector = SimpleNamespace(detect=lambda _: [(0.9, region), (0.88, region | {'x': .5})])
        vision.ocr = lambda _: SimpleNamespace(txts=None, scores=None, boxes=None)
        image = np.zeros((100, 200, 3), dtype=np.uint8)
        self.assertEqual(len(vision.propose(image)), 2)
        vision.detector.detect = lambda _: (_ for _ in ()).throw(RuntimeError('unavailable'))
        self.assertEqual(vision.propose(image), [])

    def test_published_detector_threshold_keeps_small_goods_and_bounds_model_boxes(self):
        detector = Detector.__new__(Detector)
        boxes = np.array([[0, .8, 0, 0, 190, 90], [0, .4, 100, 40, 110, 80],
                          [0, .19, 0, 0, 60, 90], [1, .9, 0, 0, 40, 90],
                          [0, .9, 1, 1, 1, 20], [0, .9, 0, 0, np.nan, 20]])
        detector.predictor = SimpleNamespace(get_input_names=lambda: [], run=lambda: None,
            get_output_names=lambda: ['boxes'], get_output_handle=lambda _: SimpleNamespace(copy_to_cpu=lambda: boxes))
        regions = detector.detect(np.zeros((100, 200, 3), np.uint8))
        self.assertEqual(len(regions), 2)
        self.assertLess(regions[1][1]['width']*regions[1][1]['height'], .03)
        self.assertTrue(all(valid_region(region) for _, region in regions))


if __name__ == '__main__':
    unittest.main()
