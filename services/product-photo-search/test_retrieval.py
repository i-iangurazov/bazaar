"""Real Faiss protocol checks. No network or paid provider calls."""
import base64
import struct
import unittest
from retrieval import Searcher


def matrix(rows):
    return base64.b64encode(b"".join(struct.pack("<512f", *row) for row in rows)).decode()


class RetrievalTest(unittest.TestCase):
    def test_grouping_stateless_isolation_and_bad_input_recovery(self):
        executor = Searcher(2)
        a = [1.0]+[0.0]*511
        b = [0.0, 1.0]+[0.0]*510
        try:
            hits = executor.search(matrix([a, a, b]), [0, 0, 1], a)
            self.assertEqual(len(hits), 2)
            self.assertEqual(hits[0]["score"], 1)
            # A subsequent store cannot see previous store vectors.
            hits = executor.search(matrix([b]), [0], a)
            self.assertEqual(hits, [{"index": 0, "score": 0.0}])
            for raw, groups in [("invalid", [0]), (matrix([a]), [-1]), (matrix([[0.0]*512]), [0])]:
                with self.assertRaises(ValueError):
                    executor.search(raw, groups, a)
            self.assertEqual(executor.search(matrix([a]), [0], a)[0]["score"], 1)
            executor.process.kill()
            executor.process.wait()
            with self.assertRaises(RuntimeError):
                executor.search(matrix([a]), [0], a)
            # Recovery uses a new channel, with no delayed data from the old one.
            self.assertEqual(executor.search(matrix([b]), [0], b)[0]["score"], 1)
        finally:
            executor.close()
        self.assertIsNotNone(executor.process.returncode)


    def test_many_photos_do_not_crowd_out_other_products_and_identical_skus_stay_separate(self):
        executor = Searcher(2)
        a = [1.0]+[0.0]*511
        b = [0.9, (1-0.9**2)**0.5]+[0.0]*510
        try:
            hits = executor.search(matrix([a]*12+[b]), [0]*12+[1], a)
            self.assertEqual(len(hits), 2)
            self.assertEqual(hits[1]["index"], 12)
            # Same pixels and embedding cannot distinguish two different SKUs.
            hits = executor.search(matrix([a,a]), [0,1], a)
            self.assertEqual({hit["index"] for hit in hits}, {0,1})
            self.assertTrue(all(abs(hit["score"]-1)<1e-6 for hit in hits))
            rows = [[float(i==j) for j in range(512)] for i in range(9)]
            query = [1/3]*9+[0.0]*503
            hits = executor.search(matrix(rows), list(range(9)), query)
            self.assertEqual(len(hits), 8)
            self.assertEqual(len({hit["index"] for hit in hits}), 8)
        finally:
            executor.close()


if __name__ == "__main__":
    unittest.main()
