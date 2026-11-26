import io
import unittest

import numpy as np

from retrieval import index_matches
from stream_protocol import DIMENSION, MAX_VECTORS, pack_header, read_header, valid_count
from stream_rank import rank_stream


def records(matrix, groups):
    rows = np.empty(len(matrix), dtype=[('group', '<u4'), ('vector', '<f4', (DIMENSION,))])
    rows['group'], rows['vector'] = groups, matrix
    return rows.tobytes()


class StreamRankTest(unittest.TestCase):
    def test_faiss_parity_with_ties_and_groups_across_many_blocks(self):
        random = np.random.default_rng(437)
        matrix = random.standard_normal((2307, DIMENSION), dtype=np.float32)
        matrix /= np.linalg.norm(matrix, axis=1, keepdims=True)
        # Deliberate ties and repeated product groups across several windows.
        matrix[2080:2089] = matrix[3]
        groups = (np.arange(len(matrix)) * 7) % 19
        queries = [matrix[3].tolist(), matrix[-1].tolist()]
        expected = index_matches(matrix, groups, np.array(queries, dtype=np.float32))
        for size in (59, 256, 1024):
            with self.subTest(size=size):
                result = rank_stream(io.BytesIO(records(matrix, groups)), len(matrix), queries, block_rows=size)
                self.assertEqual([[x['index'] for x in row] for row in result],
                                 [[x['index'] for x in row] for row in expected])
                np.testing.assert_allclose([[x['score'] for x in row] for row in result],
                                           [[x['score'] for x in row] for row in expected], atol=1e-6)

    def test_late_exact_match_and_all_rows_required(self):
        query = np.eye(1, DIMENSION, dtype=np.float32)
        gallery = np.repeat(-query, 2049, axis=0)
        gallery[-1] = query[0]
        groups = np.arange(len(gallery)) % 9
        raw = records(gallery, groups)
        result = rank_stream(io.BytesIO(raw), 2049, query.tolist())
        self.assertEqual(result[0][0], {'index': 2048, 'score': 1.0, 'group': 2048 % 9})
        with self.assertRaises(ValueError):
            rank_stream(io.BytesIO(raw[:-1]), 2049, query.tolist())
        groups[-1] = 9999
        with self.assertRaises(ValueError):
            rank_stream(io.BytesIO(records(gallery, groups)), 2049, query.tolist())

    def test_wire_header_and_catalog_limit(self):
        header = pack_header({'count': 63499})
        self.assertEqual(read_header(io.BytesIO(header)), ({'count': 63499}, len(header)))
        self.assertTrue(valid_count(63499))
        for value in (True, 0, -1, 1.0, MAX_VECTORS + 1):
            self.assertFalse(valid_count(value))
