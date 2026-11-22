"""Private request format shared by the HTTP listener and the Faiss process.

A little-endian uint32 JSON length, then JSON, then count records. Each record
is a uint32 product group followed by 512 float32 values, all little-endian.
"""
import json
import struct

DIMENSION = 512
MAX_VECTORS = 65_536
MAX_IMAGE_BYTES = 3 * 1024 * 1024
MAX_HEADER_BYTES = MAX_IMAGE_BYTES * 4 // 3 + 2048
RECORD_BYTES = 4 + DIMENSION * 4
BLOCK_ROWS = 1024
PROTOCOL = 'packed-f32-v1'


def read_exact(stream, size):
    value = stream.read(size)
    if len(value) != size:
        raise ValueError('truncatedRequest')
    return value


def read_header(stream):
    size, = struct.unpack('<I', read_exact(stream, 4))
    if not 0 < size <= MAX_HEADER_BYTES:
        raise ValueError('invalidHeaderLength')
    value = json.loads(read_exact(stream, size))
    if not isinstance(value, dict):
        raise ValueError('invalidHeader')
    return value, size + 4


def pack_header(value):
    data = json.dumps(value, separators=(',', ':'), allow_nan=False).encode()
    if not 0 < len(data) <= MAX_HEADER_BYTES:
        raise ValueError('invalidHeaderLength')
    return struct.pack('<I', len(data)) + data


def valid_count(count):
    return type(count) is int and 1 <= count <= MAX_VECTORS
