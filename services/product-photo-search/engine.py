"""PP-ShiTuV2 FP32 image encoder, with the published PaddleClas preprocessing.

Reference: PaddleClas 202ac79 / inference_general.yaml and predict_rec.py,
Apache-2.0. The retrieval engine is Faiss, not an application-built search model.
"""
from pathlib import Path
import hashlib
from io import BytesIO
import cv2
import numpy as np
import paddle.inference as inference
from PIL import Image, UnidentifiedImageError

MODEL_VERSION = "ppshitu-v2-pplcnetv2-v1-fp32-224"
DIMENSION = 512


class Encoder:
    def __init__(self, directory: Path, threads: int):
        for name, expected in {
            "inference.pdmodel": "3e0ade05639ff7b5fe450a55883a8087dc2b5c2349fe6b73897cbe2a5eeb6ee8",
            "inference.pdiparams": "9f2613210c4126a2880d32108ad573a5179c0af53a0acbb5db96155f8ec2ce8d",
        }.items():
            with (directory/name).open("rb") as stream:
                if hashlib.file_digest(stream, "sha256").hexdigest() != expected:
                    raise ValueError("unexpectedModelWeights")
        cv2.setNumThreads(threads)
        config = inference.Config(str(directory/"inference.pdmodel"), str(directory/"inference.pdiparams"))
        config.disable_gpu()
        config.disable_mkldnn()
        config.set_cpu_math_library_num_threads(threads)
        config.disable_glog_info()
        config.switch_ir_optim(True)
        config.enable_memory_optim()
        config.switch_use_feed_fetch_ops(False)
        self.predictor = inference.create_predictor(config)
        self.input = self.predictor.get_input_handle(self.predictor.get_input_names()[0])
        self.output = self.predictor.get_output_handle(self.predictor.get_output_names()[0])
        self.mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
        self.std = np.array([0.229, 0.224, 0.225], dtype=np.float32)

    @staticmethod
    def decode(data: bytes):
        # Public Node ingress has already decoded and bounded this JPEG. This
        # private endpoint also checks dimensions before using the model.
        try:
            with Image.open(BytesIO(data)) as header:
                if header.format != "JPEG" or not 0 < header.width*header.height <= 4_000_000:
                    raise ValueError("invalidImage")
        except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as error:
            raise ValueError("invalidImage") from error
        image = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
        if image is None or image.shape[0]*image.shape[1] > 4_000_000:
            raise ValueError("invalidImage")
        return cv2.cvtColor(image, cv2.COLOR_BGR2RGB)

    def encode(self, data: bytes):
        return self.encode_rgb(self.decode(data))

    def encode_rgb(self, image):
        image = cv2.resize(image, (224, 224), interpolation=cv2.INTER_LINEAR)
        image = (image.astype(np.float32)/255-self.mean)/self.std
        value = np.ascontiguousarray(image.transpose(2, 0, 1)[None])
        self.input.reshape(value.shape)
        self.input.copy_from_cpu(value)
        self.predictor.run()
        vector = self.output.copy_to_cpu().reshape(-1).astype(np.float32)
        norm = np.linalg.norm(vector)
        if vector.size != DIMENSION or not np.isfinite(vector).all() or norm < 1e-8:
            raise ValueError("invalidFeatures")
        return vector/norm
