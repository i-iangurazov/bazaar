"""Thin CPU adapters around official pretrained models; no training or hosted inference."""
from __future__ import annotations

import gc
from pathlib import Path
import sys

import numpy as np

from prepare import CN_CODE_REVISION


class PPShiTu:
    name = "PP-ShiTuV2 / general_PPLCNetV2_base_pretrained_v1.0"

    def __init__(self, root: Path, threads: int):
        import cv2
        import paddle.inference as inference

        self.cv2 = cv2
        cv2.setNumThreads(threads)
        directory = root / "models/general_PPLCNetV2_base_pretrained_v1.0_infer"
        self.weights_bytes = sum(path.stat().st_size for path in directory.iterdir() if path.is_file())
        config = inference.Config(str(directory / "inference.pdmodel"), str(directory / "inference.pdiparams"))
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

    def prepare(self, paths: list[Path]):
        images = []
        for path in paths:
            image = self.cv2.imread(str(path))
            if image is None:
                raise ValueError(f"unreadable image: {path.name}")
            image = self.cv2.cvtColor(image, self.cv2.COLOR_BGR2RGB)
            image = self.cv2.resize(image, (224, 224), interpolation=self.cv2.INTER_LINEAR)
            image = (image.astype(np.float32) / 255 - self.mean) / self.std
            images.append(image.transpose(2, 0, 1))
        return np.ascontiguousarray(images, dtype=np.float32)

    def infer(self, prepared):
        self.input.reshape(prepared.shape)
        self.input.copy_from_cpu(prepared)
        self.predictor.run()
        return self.output.copy_to_cpu()


class ChineseCLIP:
    name = "Chinese-CLIP ViT-B/16 / official checkpoint / vision encoder only"

    def __init__(self, root: Path, threads: int):
        import torch
        from PIL import Image

        torch.set_num_threads(threads)
        torch.set_num_interop_threads(1)
        sys.path.insert(0, str(root / f"vendor/Chinese-CLIP-{CN_CODE_REVISION}"))
        from cn_clip.clip.utils import load_from_name

        checkpoint = root / "models/clip_cn_vit-b-16.pt"
        model, self.transform = load_from_name(
            str(checkpoint), device="cpu", vision_model_name="ViT-B-16",
            text_model_name="RoBERTa-wwm-ext-base-chinese", input_resolution=224,
        )
        # Only photo-to-photo retrieval is measured. The unused text encoder is
        # released; the full official checkpoint remains the provenance source.
        self.model = model.visual.float().eval()
        self.visual_parameters = sum(parameter.numel() for parameter in self.model.parameters())
        del model
        gc.collect()
        self.Image = Image
        self.torch = torch
        self.weights_bytes = checkpoint.stat().st_size

    def prepare(self, paths: list[Path]):
        images = []
        for path in paths:
            with self.Image.open(path) as image:
                images.append(self.transform(image))
        return self.torch.stack(images).to("cpu")

    def infer(self, prepared):
        with self.torch.inference_mode():
            return self.model(prepared).float().cpu().numpy()
