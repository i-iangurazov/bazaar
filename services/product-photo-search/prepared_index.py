"""Read one immutable, store-scoped index published by product-photo-index.ts."""
from contextlib import contextmanager
import hashlib
import json
import os
import re
import struct

from stream_protocol import MAX_VECTORS, RECORD_BYTES, read_exact, valid_count

HEADER_BYTES = 4096
REFERENCE_BYTES = 32
DIGEST = re.compile(r'[a-f0-9]{64}\Z')


class SnapshotMissing(Exception):
    """The app can prepare/search the current gallery using the existing path."""


class PreparedPhotoIndexes:
    def __init__(self, root, model_version):
        self.root = root
        self.model_version = model_version
        self.verified = None

    @contextmanager
    def open(self, request):
        org, store, revision = (request.get(name) for name in ('organizationId', 'storeId', 'revision'))
        if not all(isinstance(part, str) and 0 < len(part) <= 128 for part in (org, store)):
            raise ValueError('invalidSnapshotScope')
        if revision is not None and (not isinstance(revision, str) or not DIGEST.fullmatch(revision)):
            raise ValueError('invalidSnapshotRevision')
        scope = hashlib.sha256(json.dumps([org, store], ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
        try:
            file = (self.root / (scope + '.index')).open('rb')
        except FileNotFoundError as error:
            raise SnapshotMissing from error
        with file:
            try:
                header = read_exact(file, HEADER_BYTES)
                size, = struct.unpack_from('<I', header)
                if not 0 < size <= HEADER_BYTES - 4:
                    raise ValueError('invalidSnapshotHeader')
                meta = json.loads(header[4:4+size])
                count, without, digest = (meta[name] for name in ('count', 'withoutPhoto', 'sha256'))
                if meta['organizationId'] != org or meta['storeId'] != store or meta['modelVersion'] != self.model_version:
                    raise ValueError('wrongSnapshotScope')
                if (not valid_count(count) or not count or type(without) is not int or not 0 <= without <= MAX_VECTORS
                        or not isinstance(digest, str) or not DIGEST.fullmatch(digest)):
                    raise ValueError('invalidSnapshotMetadata')
                current_revision = meta['revision']
                if not isinstance(current_revision, str) or not DIGEST.fullmatch(current_revision):
                    raise ValueError('invalidSnapshotRevision')
                if revision is not None and current_revision != revision:
                    raise SnapshotMissing
                stat = os.fstat(file.fileno())
                if stat.st_size != HEADER_BYTES + count * (RECORD_BYTES + REFERENCE_BYTES):
                    raise ValueError('invalidSnapshotSize')
            except (KeyError, OSError, TypeError, ValueError) as error:
                raise RuntimeError('invalidPreparedIndex') from error
            yield file, {'revision': current_revision, 'count': count, 'withoutPhoto': without}, (stat.st_dev, stat.st_ino, stat.st_mtime_ns, digest)

    def verify(self, file, identity):
        if self.verified == identity:
            return
        digest = hashlib.sha256()
        for block in iter(lambda: file.read(1024 * 1024), b''):
            digest.update(block)
        if digest.hexdigest() != identity[-1]:
            raise RuntimeError('invalidSnapshotHash')
        file.seek(HEADER_BYTES)
        self.verified = identity

    @staticmethod
    def release_vectors(file, count):
        # Ranking is finished. Release clean index pages before loading OCR weights.
        if hasattr(os, 'posix_fadvise') and hasattr(os, 'POSIX_FADV_DONTNEED'):
            try:
                os.posix_fadvise(file.fileno(), HEADER_BYTES, count * RECORD_BYTES, os.POSIX_FADV_DONTNEED)
            except OSError:
                pass  # A filesystem hint must not affect availability or ranking.

    @staticmethod
    def match_sources(file, count, matches):
        offset = HEADER_BYTES + count * RECORD_BYTES
        for match in matches:
            file.seek(offset + match['index'] * REFERENCE_BYTES)
            match['sourceKey'] = read_exact(file, REFERENCE_BYTES).hex()
