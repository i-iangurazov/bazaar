"""The hard cohort is selected from gallery identities, before query inference."""
import unittest
import numpy as np
from wide import hard_pairs


class WideProtocolTest(unittest.TestCase):
    def test_nearest_pairs_cannot_pair_two_views_of_one_product_or_reuse_a_product(self):
        rows = [{'id': str(i), 'productId': p} for i, p in enumerate(['a', 'a', 'b', 'c', 'd'])]
        matrix = np.array([[1, 0], [1, 0], [.99, .01], [0, 1], [.01, .99]], dtype=np.float32)
        pairs = hard_pairs(rows, matrix, 2)
        self.assertEqual({tuple(p['productIds']) for p in pairs}, {('a', 'b'), ('c', 'd')})
        self.assertEqual(len({p for pair in pairs for p in pair['productIds']}), 4)

    def test_ties_use_stable_identity_order_and_one_product_yields_no_pair(self):
        rows = [{'id': p, 'productId': p} for p in ['c', 'b', 'a']]
        self.assertEqual(hard_pairs(rows, np.ones((3, 2)), 1)[0]['productIds'], ('a', 'b'))
        self.assertEqual(hard_pairs(rows[:1], np.ones((1, 2)), 1), [])


if __name__ == '__main__':
    unittest.main()
