"""Read and score all gallery rows, using constant-size Faiss blocks."""
import json
import sys

from retrieval import DIMENSION, MAX_QUERIES, index_matches, validate_vectors
from stream_protocol import BLOCK_ROWS, RECORD_BYTES, read_exact, read_header, valid_count


def score_key(hit):
    # IndexFlatIP with k equal to the block size orders exact ties by later row.
    return hit['score'], hit['index']


def merge_batches(left, right):
    best = {}
    for hit in [*left, *right]:
        current = best.get(hit['group'])
        if not current or score_key(hit) > score_key(current):
            best[hit['group']] = hit
    return sorted(best.values(), key=score_key, reverse=True)[:8]


def rank_stream(stream, count, queries, block_rows=BLOCK_ROWS):
    import numpy as np
    if not valid_count(count) or not isinstance(queries, list) or not 1 <= len(queries) <= MAX_QUERIES:
        raise ValueError('invalidSearch')
    query = np.ascontiguousarray(queries, dtype=np.float32)
    if query.shape != (len(queries), DIMENSION):
        raise ValueError('invalidQuery')
    validate_vectors(query)
    dtype = np.dtype([('group', '<u4'), ('vector', '<f4', (DIMENSION,))])
    best = [[] for _ in queries]
    for offset in range(0, count, block_rows):
        size = min(block_rows, count - offset)
        block = np.frombuffer(read_exact(stream, size * RECORD_BYTES), dtype=dtype)
        if (block['group'] >= count).any():
            raise ValueError('invalidGroups')
        matrix = np.ascontiguousarray(block['vector'], dtype=np.float32)
        validate_vectors(matrix)
        batches = index_matches(matrix, block['group'], query, offset)
        # An omitted group has eight better distinct groups in that same block.
        # Therefore only eight group winners per view need to cross a block boundary.
        best = [merge_batches(previous, batch) for previous, batch in zip(best, batches)]
    return best


if __name__ == '__main__':
    import faiss
    faiss.omp_set_num_threads(int(sys.argv[1]))
    try:
        header, _ = read_header(sys.stdin.buffer)
        print(json.dumps({'batches': rank_stream(sys.stdin.buffer, header['count'], header['queries'])}))
    except (ValueError, TypeError, KeyError):
        print('{"error":"invalidInput"}')
