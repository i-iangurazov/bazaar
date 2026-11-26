"""CPU visual models used before loading the OCR runtime."""
import base64

import cv2
import numpy as np
import onnxruntime as ort

from engine import Encoder
from picodet_heads import decode_heads
from stream_protocol import MAX_IMAGE_BYTES
from vision import detector_input, proposal_regions


def request_rgb(request):
    data = base64.b64decode(request['imageBase64'], validate=True)
    if not 0 < len(data) <= MAX_IMAGE_BYTES:
        raise ValueError('invalidImage')
    return Encoder.decode(data)


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
