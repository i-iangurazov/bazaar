import unittest
from elfbar_comparison import merged
from elfbar_metrics import counts, leave_target_out
from metrics import rejection_threshold
from elfbar_consensus import select


class EncoderComparisonTests(unittest.TestCase):
    def test_photos_and_views_do_not_crowd_out_other_products(self):
        sources = [{'productId': 'a', 'sku': 'A'}, {'productId': 'a', 'sku': 'A'}, {'productId': 'b', 'sku': 'B'}]
        hits = merged([[.9, .8, .7], [.5, .95, .75]], [[0, 1, 2], [0, 1, 2]], sources)
        self.assertEqual([hit['productId'] for hit in hits], ['a', 'b'])
        self.assertEqual(hits[0]['sourceIndex'], 1)
        self.assertEqual(merged([[.9, .8, .7]], [[0, 1, 2]], sources, exclude='a')[0]['productId'], 'b')

    def test_absent_targets_are_not_counted_as_wrong_known_sku_or_success(self):
        rows = [{'expectedId': 'a', 'matches': [{'productId': 'b', 'score': .9}, {'productId': 'a', 'score': .8}]},
                {'expectedId': None, 'matches': [{'productId': 'b', 'score': .91}]}]
        result = counts(rows, .85)
        self.assertEqual(result['rawTop5'], 1)
        self.assertEqual(result['acceptedCorrectTop5'], 0)
        self.assertEqual(result['acceptedWrongFirst'], 1)
        self.assertEqual(result['withCandidates'], 2)
        self.assertEqual(result['acceptedCorrectFirst'], 0)

    def test_rejection_does_not_improve_raw_rank_and_calibration_rejects_boundary_ties(self):
        rows = [{'expectedId': 'a', 'matches': [{'productId': 'a', 'score': .8}]}]
        self.assertEqual(counts(rows, .9)['rawTop1'], 1)
        self.assertEqual(counts(rows, .9)['acceptedCorrectFirst'], 0)
        threshold = rejection_threshold([.6, .8, .8], max_false_accept=0)
        self.assertGreater(threshold, .8)
        self.assertEqual(counts(rows, threshold)['empty'], 1)

    def test_real_store_scopes_and_equal_skus_are_not_merged_across_inputs(self):
        one = [{'productId': 'a', 'sku': 'SHARED'}]
        other = [{'productId': 'b', 'sku': 'SHARED'}]
        self.assertEqual(merged([[1]], [[0]], one)[0]['productId'], 'a')
        self.assertEqual(merged([[.4]], [[0]], other)[0]['productId'], 'b')
        self.assertEqual(merged([[1, 1]], [[0, 1]], one+other)[0]['sourceIndex'], 0)

    def test_consensus_retains_existing_candidates_and_requires_id_agreement(self):
        base = [{'productId': 'a', 'score': .8}]
        fallback = [{'productId': 'b', 'score': .99}]
        self.assertEqual(select(base, fallback, .68, .7), (base, 'base'))
        base[0]['score'] = .4
        self.assertEqual(select(base, fallback, .68, .7), ([], 'rejected'))
        fallback[0]['productId'] = 'a'
        self.assertEqual(select(base, fallback, .68, .7), (fallback, 'agreement'))
        fallback[0]['score'] = .69
        self.assertEqual(select(base, fallback, .68, .7), ([], 'rejected'))
        self.assertEqual(select([], fallback, .68, .7), ([], 'rejected'))

    def test_removed_target_keeps_multi_object_ambiguity_separate(self):
        rows = [{'expectedId': target, 'multiObject': multi, 'absentMatches': [{'score': score}]}
            for target, multi, score in [('a', False, .8), ('b', False, .5), ('c', True, .9), (None, False, .9)]]
        result = leave_target_out(rows, .7)
        self.assertEqual((result['queries'], result['withCandidates']), (3, 2))
        self.assertEqual(result['knownSingle'], {'queries': 2, 'withCandidates': 1})
        self.assertEqual(result['knownMultiple'], {'queries': 1, 'withCandidates': 1})


if __name__ == '__main__':
    unittest.main()
