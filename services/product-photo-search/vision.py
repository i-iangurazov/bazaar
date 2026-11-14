"""Pinned PaddleClas mainbody detector + RapidOCR/PP-OCRv6. CPU, offline.

Detector preprocessing follows PaddleClas 202ac79 deploy/python/predict_det.py,
det_preprocess.py and deploy/configs/inference_general.yaml (Apache-2.0).
Modified for bounded private requests; no PaddleClas application framework required.
Copyright (c) 2020 PaddlePaddle Authors. Licensed under Apache License 2.0.
"""
import hashlib
import json
import math
import re
from pathlib import Path
import cv2
import numpy as np
import paddle.inference as inference


def valid_region(region):
    if not isinstance(region, dict) or set(region) != {'x', 'y', 'width', 'height'}:
        return False
    if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in region.values()):
        return False
    return (0 <= region['x'] < 1 and 0 <= region['y'] < 1 and 0 < region['width'] <= 1 and 0 < region['height'] <= 1
            and region['x']+region['width'] <= 1.000001 and region['y']+region['height'] <= 1.000001)


def crop_region(image, region):
    if not valid_region(region):
        raise ValueError('invalidRegion')
    h, w = image.shape[:2]
    x, y = int(region['x']*w), int(region['y']*h)
    right = min(w, math.ceil((region['x']+region['width'])*w))
    bottom = min(h, math.ceil((region['y']+region['height'])*h))
    if right-x < 4 or bottom-y < 4:
        raise ValueError('invalidRegion')
    return image[y:bottom, x:right].copy()


def fallback_analysis(region=None):
    return {'regionSource': 'manual' if region else 'full', 'region': region,
            'ocrStatus': 'unavailable', 'lines': []}


class Detector:
    def __init__(self, directory, threads):
        config = inference.Config(str(directory/'inference.pdmodel'), str(directory/'inference.pdiparams'))
        config.disable_gpu()
        config.disable_mkldnn()
        config.set_cpu_math_library_num_threads(threads)
        config.disable_glog_info()
        config.switch_ir_optim(True)
        config.enable_memory_optim()
        config.switch_use_feed_fetch_ops(False)
        self.predictor = inference.create_predictor(config)

    def detect(self, rgb):
        h, w = rgb.shape[:2]
        pixels = cv2.resize(rgb, (640, 640), interpolation=cv2.INTER_CUBIC).astype(np.float32)/255
        pixels = (pixels-np.array([0.485, 0.456, 0.406], np.float32))/np.array([0.229, 0.224, 0.225], np.float32)
        values = {'image': np.ascontiguousarray(pixels.transpose(2, 0, 1)[None]),
                  'im_shape': np.array([[640, 640]], np.float32),
                  'scale_factor': np.array([[640/h, 640/w]], np.float32)}
        for name in self.predictor.get_input_names():
            self.predictor.get_input_handle(name).copy_from_cpu(values[name])
        self.predictor.run()
        boxes = self.predictor.get_output_handle(self.predictor.get_output_names()[0]).copy_to_cpu()
        if boxes.ndim != 2 or boxes.shape[1] != 6:
            raise ValueError('invalidDetection')
        regions = []
        for label, score, left, top, right, bottom in boxes:
            # Published PaddleClas inference_general.yaml: threshold .2, top five.
            # Detection confidence is not a SKU similarity score.
            if label != 0 or not np.isfinite([score, left, top, right, bottom]).all() or score < 0.2:
                continue
            # Small context margin; never synthesize a different view or change colors.
            pad_x, pad_y = (right-left)*0.03, (bottom-top)*0.03
            left, top = max(0, left-pad_x), max(0, top-pad_y)
            right, bottom = min(w, right+pad_x), min(h, bottom+pad_y)
            region = {'x': float(left/w), 'y': float(top/h), 'width': float((right-left)/w), 'height': float((bottom-top)/h)}
            if valid_region(region) and right-left >= 4 and bottom-top >= 4 and region['width']*region['height'] < 0.95:
                regions.append((float(score), region))
        return sorted(regions, key=lambda item: -item[0])[:5]


class Vision:
    def __init__(self, root: Path, threads):
        registry = json.loads(Path(__file__).with_name('vision-models.json').read_text())
        for name, expected in registry['files'].items():
            path = root/name
            with path.open('rb') as stream:
                if hashlib.file_digest(stream, 'sha256').hexdigest() != expected:
                    raise ValueError('unexpectedVisionWeights')
        self.detector = Detector(root/registry['detectorDirectory'], threads)
        from rapidocr import RapidOCR, ModelType
        self.ocr = RapidOCR(params={
            'Global.log_level': 'error', 'Global.max_side_len': 1600,
            'Det.max_candidates': 200,
            'EngineConfig.onnxruntime.intra_op_num_threads': threads,
            'EngineConfig.onnxruntime.inter_op_num_threads': 1,
            'Det.model_path': str(root/'ocr/PP-OCRv6_det_small.onnx'),
            'Rec.model_path': str(root/registry['recognizerFile']),
            'Rec.model_type': ModelType.MEDIUM,
            'Cls.model_path': str(root/'ocr/ch_ppocr_mobile_v2.0_cls_mobile.onnx'),
        })

    def propose(self, rgb):
        try:
            return self.detector.detect(rgb)
        except Exception:
            return []  # Full-image visual search still works; do not invent boxes.

    def read(self, rgb, region=None, source='full'):
        """Bounded OCR; an automatic crop may recover in-region text at full scale.

        Never broaden a human crop. A contextual pass may return only text boxes
        fully contained in the automatic product region, never shelf/background text.
        """
        analysis = self._read_once(rgb, region, source)
        def has_label(lines):
            return any(line['confidence'] >= .85 and len(re.findall(r'[^\W\d_]{2,}', line['text'])) >= 2 for line in lines)
        if source != 'auto' or region is None or has_label(analysis['lines']):
            return analysis
        full = self._read_once(rgb, None, 'full')
        contained = []
        for line in full['lines']:
            box = line['box']
            if (box['x'] >= region['x'] and box['y'] >= region['y']
                    and box['x']+box['width'] <= region['x']+region['width']
                    and box['y']+box['height'] <= region['y']+region['height']):
                local = {'x': (box['x']-region['x'])/region['width'],
                    'y': (box['y']-region['y'])/region['height'],
                    'width': box['width']/region['width'], 'height': box['height']/region['height']}
                if valid_region(local):
                    contained.append({**line, 'box': local})
        if has_label(contained):
            analysis.update(ocrStatus='ready', lines=contained)
        return analysis

    def _read_once(self, rgb, region=None, source='full'):
        selected = crop_region(rgb, region) if region else rgb
        analysis = {'regionSource': source, 'region': region, 'ocrStatus': 'unavailable', 'lines': []}
        try:
            output = self.ocr(cv2.cvtColor(selected, cv2.COLOR_RGB2BGR))
            h, w = selected.shape[:2]
            lines = []
            if output.txts is not None and output.scores is not None and output.boxes is not None:
                for text, confidence, points in zip(output.txts, output.scores, output.boxes):
                    if not isinstance(text, str) or not text.strip() or not math.isfinite(float(confidence)):
                        continue
                    x, y = np.maximum(0, points.min(axis=0))
                    right, bottom = np.minimum([w, h], points.max(axis=0))
                    box = {'x': float(x/w), 'y': float(y/h), 'width': float((right-x)/w), 'height': float((bottom-y)/h)}
                    if valid_region(box):
                        lines.append({'text': text[:120], 'confidence': max(0, min(1, float(confidence))), 'box': box})
                    if len(lines) == 24:
                        break
            analysis.update(ocrStatus='ready', lines=lines)
        except Exception:
            pass  # Explicit unavailable state; OCR never silently confirms a product.
        return analysis
