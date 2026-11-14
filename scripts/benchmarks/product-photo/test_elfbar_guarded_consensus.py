import unittest
from pathlib import Path
import runpy
from elfbar_guarded_consensus import select_guarded


class GuardedConsensusTests(unittest.TestCase):
    def test_rejects_ambiguous_agreement_without_replacing_existing_pp_matches(self):
        base = [{'productId': 'a', 'score': .46}, {'productId': 'b', 'score': .45}]
        other = [{'productId': 'a', 'score': .72}]
        self.assertEqual(select_guarded(base, other, .68, .674, .05), ([], 'ambiguousPP'))
        base[0]['score'] = .8
        self.assertEqual(select_guarded(base, other, .68, .674, .05), (base[:1], 'base'))

    def test_uses_next_distinct_product_and_accepts_exact_gap_boundary(self):
        base = [{'productId': 'a', 'score': .5}, {'productId': 'a', 'score': .49},
                {'productId': 'b', 'score': .375}]
        other = [{'productId': 'a', 'score': .75}]
        self.assertEqual(select_guarded(base, other, .68, .674, .125), (other, 'guardedAgreement'))
        self.assertEqual(select_guarded(base[:1], other, .68, .674, .125), ([], 'insufficientCompetitors'))

    def test_rejects_id_disagreement_low_dino_and_empty_inputs(self):
        base = [{'productId': 'a', 'score': .6}, {'productId': 'b', 'score': .3}]
        for other in [[], [{'productId': 'b', 'score': .9}], [{'productId': 'a', 'score': .5}]]:
            self.assertEqual(select_guarded(base, other, .68, .674, .05), ([], 'rejected'))
        self.assertEqual(select_guarded([], [{'productId': 'a', 'score': .9}], .68, .674, .05), ([], 'rejected'))

    def test_report_keeps_true_absent_and_removed_target_errors_distinct(self):
        evaluate = runpy.run_path(str(Path(__file__).with_name('summarize-independent-elfbar.py')))['evaluate']
        def row(id, target, score, second):
            return {'id': id, 'expectedId': target, 'multiObject': False,
                'matches': [{'productId': 'a', 'sku': 'A', 'score': score}, {'productId': 'b', 'sku': 'B', 'score': second}],
                'absentMatches': [{'productId': 'a', 'sku': 'A', 'score': .46}, {'productId': 'b', 'sku': 'B', 'score': .45}]}
        base = [row('known', 'a', .8, .3), row('absent', None, .46, .45)]
        fallback = [row('known', 'a', .9, .3), row('absent', None, .72, .4)]
        for value in fallback:
            value['absentMatches'][0]['score'] = .72
        output = evaluate(base, fallback, {'baseThreshold': .68, 'fallbackThreshold': .674, 'minimumPpProductGap': .05})
        self.assertEqual(output['agreement']['summary']['absent']['withCandidates'], 1)
        self.assertEqual(output['guarded']['summary']['absent']['withCandidates'], 0)
        self.assertEqual(output['guarded']['summary']['knownSingle']['acceptedCorrectFirst'], 1)
        self.assertEqual(output['guarded']['summary']['leaveTargetOut']['queries'], 1)


if __name__ == '__main__':
    unittest.main()
