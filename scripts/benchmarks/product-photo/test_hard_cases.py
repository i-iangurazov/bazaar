"""Checks of ground-truth accounting, independent of any claimed model accuracy."""
import unittest
import numpy as np
from hard_cases import select_pairs, ranked_products, summarize


class HardCasesTest(unittest.TestCase):
    def test_pair_selection_uses_eligible_gallery_identities_and_distinct_products(self):
        gallery=[{'id':str(i),'product_id':p} for i,p in enumerate(['a','a','b','c','unknown'])]
        vectors=np.array([[1,0],[1,0],[0.99,0.1],[0,1],[1,0]],dtype=np.float32)
        pairs=select_pairs(gallery,vectors,{'a','b','c'},1)
        self.assertEqual(pairs[0]['products'],('a','b'))
        self.assertNotIn('unknown',pairs[0]['products'])

    def test_distinct_identity_ranking_and_threshold_can_reduce_visible_recall(self):
        gallery=[{'product_id':p,'id':str(i)} for i,p in enumerate(['wrong','wrong','correct'])]
        matches=ranked_products(np.array([0.8,0.79,0.67]),gallery)
        self.assertEqual([m['product_id'] for m in matches],['wrong','correct'])
        rows=[{'known':True,'product_id':'correct','matches':matches}]
        metric=summarize(rows,0.68)
        self.assertEqual(metric['raw_recall_at_5'],1)
        self.assertEqual(metric['visible_recall_at_5'],0)
        self.assertEqual(metric['visible_wrong_top1_rate'],1)

    def test_absent_products_are_counted_as_candidates_not_correct_identifications(self):
        metric=summarize([{'known':False,'product_id':'absent','matches':[{'product_id':'similar','score':0.9}]}],0.68)
        self.assertEqual(metric['unknown_candidate_rate'],1)
        self.assertIsNone(metric['raw_recall_at_1'])
        self.assertEqual(metric['known_queries'],0)


if __name__=='__main__':
    unittest.main()
