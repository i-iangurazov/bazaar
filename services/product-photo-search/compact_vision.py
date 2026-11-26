"""CPU inference with one OCR model resident at a time."""
import ctypes
import sys

import cv2
import numpy as np
import onnxruntime as ort
from rapidocr import RapidOCR

from compact_visual_models import CompactDetector, CompactEncoder, ort_session
from vision import PhotoTextReader


class OcrModelSlot:
    """Release one set of weights and its workspace before opening the next."""
    def __init__(self, threads):
        self.threads = threads
        self.path = self.model = None
        self.trim = getattr(ctypes.CDLL(None), 'malloc_trim', None) if sys.platform == 'linux' else None

    def clear(self):
        self.path = self.model = None
        if self.trim:
            self.trim(0)

    def get(self, path):
        if path != self.path:
            self.clear()
            self.model = ort_session(path, self.threads)
            self.path = path
        return self.model


class OcrSession(ort.InferenceSession):
    """RapidOCR accepts an InferenceSession with these four entry points.

    The shared slot owns the native session, so this adapter never initializes
    the superclass's native state.
    """
    def __init__(self, slot, path, recognize=False):
        self.slot, self.path, self.recognize = slot, path, recognize

    def get_inputs(self):
        return self.slot.get(self.path).get_inputs()

    def get_outputs(self):
        return self.slot.get(self.path).get_outputs()

    def get_modelmeta(self):
        return self.slot.get(self.path).get_modelmeta()

    def run(self, output_names, feeds, run_options=None):
        session = self.slot.get(self.path)
        if not self.recognize:
            return session.run(output_names, feeds, run_options)
        name, values = next(iter(feeds.items()))
        if len(values) <= 1:
            return session.run(output_names, feeds, run_options)
        # Preserve the padding width RapidOCR picked for the entire batch.
        rows = [session.run(output_names, {name: row[None]}, run_options) for row in values]
        return [np.concatenate(parts, axis=0) for parts in zip(*rows)]


class CompactRapidOCR(RapidOCR):
    def _initialize(self, cfg):
        # The pinned RapidOCR release supports user-supplied ORT sessions.
        cfg._set_flag('allow_objects', True)
        self.slot = OcrModelSlot(cfg.EngineConfig.onnxruntime.intra_op_num_threads)
        cfg.Det.session = OcrSession(self.slot, cfg.Det.model_path)
        cfg.Cls.session = OcrSession(self.slot, cfg.Cls.model_path)
        cfg.Rec.session = OcrSession(self.slot, cfg.Rec.model_path, recognize=True)
        super()._initialize(cfg)
        self.slot.clear()


def compact_text_reader(root, threads):
    cv2.setNumThreads(threads)
    return PhotoTextReader(root, threads, ocr_factory=CompactRapidOCR)
