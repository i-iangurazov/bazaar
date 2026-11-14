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


if __name__ == "__main__":
    unittest.main()
