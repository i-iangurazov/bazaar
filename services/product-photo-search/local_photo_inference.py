"""Reuse the visual models and release them before opening the OCR weights."""
import ctypes
import gc

import cv2
import faiss

from compact_visual_models import CompactDetector, CompactEncoder, request_rgb
from pipeline import describe_views
from stream_rank import rank_stream


class LocalPhotoInference:
    def __init__(self, args):
        self.args = args
        self.trim = getattr(ctypes.CDLL(None), 'malloc_trim', None)
        cv2.setNumThreads(args.threads)
        faiss.omp_set_num_threads(args.threads)
        self.detector = self.encoder = None
        self.text_reader = None
        self.start_visual()

    def release_unused_memory(self):
        if self.trim:
            self.trim(0)

    def start_visual(self):
        if self.detector is None or self.encoder is None:
            self.detector = CompactDetector(self.args.model_dir, self.args.threads)
            self.encoder = CompactEncoder(self.args.model_dir, self.args.threads)
            self.release_unused_memory()

    def close(self):
        self.detector = self.encoder = None
        gc.collect()
        self.release_unused_memory()

    def embed(self, request):
        self.start_visual()
        result = self.encoder.encode_rgb(request_rgb(request)).tolist()
        self.release_unused_memory()
        return {'embedding': result}

    def describe(self, request, region, automatic):
        self.start_visual()
        detect = self.detector.detect if automatic and not region else None
        regions, queries = describe_views(request_rgb(request), self.encoder, detect, region, automatic)
        self.release_unused_memory()
        return {'regions': regions, 'queries': queries}

    def rank(self, reader, count, queries):
        # The descriptors are complete. Release visual weights before reading the gallery.
        self.close()
        # The small Faiss blocks need less workspace when ranked by one thread.
        faiss.omp_set_num_threads(1)
        result = rank_stream(reader, count, queries)
        self.release_unused_memory()
        return result

    def read_text(self, request, box, source):
        from compact_vision import compact_text_reader

        try:
            if self.text_reader is None:
                self.text_reader = compact_text_reader(self.args.vision_model_dir, self.args.threads)
            return self.text_reader.read(request_rgb(request), box, source)
        finally:
            # Keep preprocessing and the OCR dictionary. Only one set of native weights fits.
            if self.text_reader is not None:
                self.text_reader.ocr.slot.clear()
            gc.collect()
            self.release_unused_memory()
