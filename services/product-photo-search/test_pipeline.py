"""Recognition chooses among real model proposals; manual/full controls stay exact."""
from types import SimpleNamespace
import unittest
import numpy as np
from pipeline import search_views


class PipelineTest(unittest.TestCase):
    def setUp(self):
        self.image = np.zeros((100, 200, 3), np.uint8)
        self.seen = []
        self.encoder = SimpleNamespace(encode_rgb=self.encode)
        self.box = {'x': .4, 'y': .2, 'width': .2, 'height': .6}

    def encode(self, pixels):
        self.seen.append(pixels.shape)
        return np.array([1.0]+[0.0]*511)

    def test_a_product_proposal_can_beat_a_more_confident_hand_without_discarding_either(self):
        hand = {'x': 0, 'y': 0, 'width': 1, 'height': .9}
        vision = SimpleNamespace(propose=lambda _: [(.9, hand), (.4, self.box)],
            read=lambda _, region, source: {'region': region, 'regionSource': source})
        searcher = SimpleNamespace(search_many=lambda matrix, groups, queries: [
            [{'index': 0, 'score': .4}], [{'index': 0, 'score': .5}], [{'index': 1, 'score': .8}]])
        result = search_views(self.image, self.encoder, searcher, 'scoped-vectors', [0, 1], vision)
        self.assertEqual(result['analysis'], {'region': self.box, 'regionSource': 'auto'})
        self.assertEqual(result['matches'], [{'index': 1, 'score': .8}, {'index': 0, 'score': .5}])
        self.assertEqual(len(self.seen), 3)

    def test_manual_and_disabled_detection_never_add_other_views(self):
        def forbidden(_):
            raise AssertionError('must not detect')
        vision = SimpleNamespace(propose=forbidden, read=lambda _, region, source: {'region': region, 'regionSource': source})
        searcher = SimpleNamespace(search_many=lambda matrix, groups, queries: [[{'index': 0, 'score': .8}] for _ in queries])
        result = search_views(self.image, self.encoder, searcher, 'scoped', [0], vision, self.box)
        self.assertEqual(result['analysis'], {'region': self.box, 'regionSource': 'manual'})
        self.assertEqual(len(self.seen), 1)
        self.assertEqual(self.seen[0][0], 60)
        self.assertIn(self.seen[0][1], [40, 41])  # Outward pixel rounding at fractional bounds.
        self.seen.clear()
        result = search_views(self.image, self.encoder, searcher, 'scoped', [0], vision, automatic=False)
        self.assertEqual(result['analysis'], {'region': None, 'regionSource': 'full'})
        self.assertEqual(self.seen, [(100, 200, 3)])

    def test_six_view_bound_group_deduplication_and_full_view_tie(self):
        vision = SimpleNamespace(propose=lambda _: [(.4, self.box)]*10,
            read=lambda _, region, source: {'region': region, 'regionSource': source})
        def search(matrix, groups, queries):
            self.assertEqual(matrix, 'scoped')
            self.assertEqual(len(queries), 6)
            return [[{'index': index, 'score': .8} for index in range(8)] for _ in queries]
        result = search_views(self.image, self.encoder, SimpleNamespace(search_many=search), 'scoped', list(range(8)), vision)
        self.assertEqual(len(result['matches']), 8)
        self.assertEqual(result['analysis'], {'region': None, 'regionSource': 'full'})

    def test_no_vision_keeps_manual_region_and_explicit_unavailable_ocr(self):
        searcher = SimpleNamespace(search_many=lambda matrix, groups, queries: [[{'index': 0, 'score': .8}]])
        result = search_views(self.image, self.encoder, searcher, 'scoped', [0], region=self.box)
        self.assertEqual(result['analysis'], {'region': self.box, 'regionSource': 'manual', 'ocrStatus': 'unavailable', 'lines': []})

    def test_subthreshold_background_crop_is_not_presented_as_automatic_product_selection(self):
        reads = []
        vision = SimpleNamespace(propose=lambda _: [(.9, self.box)],
            read=lambda _, region, source: reads.append((region, source)) or {'region': region, 'regionSource': source})
        searcher = SimpleNamespace(search_many=lambda *args: [[{'index': 0, 'score': .3}], [{'index': 0, 'score': .6}]])
        result = search_views(self.image, self.encoder, searcher, 'scoped', [0], vision)
        self.assertEqual(result['analysis'], {'region': None, 'regionSource': 'full'})
        self.assertEqual(result['matches'], [{'index': 0, 'score': .6}])  # Node still applies the unchanged threshold.
        self.assertEqual(reads, [(None, 'full')])
        result = search_views(self.image, self.encoder, searcher, 'scoped', [0], vision, min_score=.6)
        self.assertEqual(result['analysis']['regionSource'], 'auto')


if __name__ == '__main__':
    unittest.main()
