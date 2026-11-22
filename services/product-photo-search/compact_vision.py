"""CPU inference with one OCR model resident at a time."""
import ctypes
import sys

import cv2
import numpy as np
import onnxruntime as ort
from rapidocr import RapidOCR

from engine import Encoder
from picodet_heads import decode_heads
from vision import PhotoTextReader, detector_input, proposal_regions


def ort_session(path, threads):
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = threads
    opts.inter_op_num_threads = 1
    opts.enable_cpu_mem_arena = False
    opts.enable_mem_pattern = False
    opts.add_session_config_entry('session.disable_prepacking', '1')
    opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_EXTENDED
    return ort.InferenceSession(str(path), opts, providers=['CPUExecutionProvider'])


class CompactEncoder(Encoder):
    def __init__(self, root, threads):
        self.mean = np.array([0.485, 0.456, 0.406], np.float32)
        self.std = np.array([0.229, 0.224, 0.225], np.float32)
        self.session = ort_session(root / 'encoder.onnx', threads)
        self.input_name = self.session.get_inputs()[0].name

    def predict(self, value):
        return self.session.run(None, {self.input_name: value})[0]


class CompactDetector:
    def __init__(self, root, threads):
        self.session = ort_session(root / 'detector-heads.onnx', threads)

    def detect(self, rgb):
        values = detector_input(rgb)
        features = self.session.run(None, {'image': values['image']})
        boxes = decode_heads(features, values['scale_factor'][0])
        return proposal_regions(boxes, rgb.shape[1], rgb.shape[0])


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
