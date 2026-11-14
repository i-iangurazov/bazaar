"""Pinned ready-made vision encoders; no training, remote code or inference API."""
import hashlib
import json
from pathlib import Path
import numpy as np
from backends import PPShiTu, ChineseCLIP
from prepare import CN_WEIGHTS_SHA256


def verify(path, expected):
    with path.open('rb') as stream:
        if hashlib.file_digest(stream, 'sha256').hexdigest() != expected:
            raise ValueError(f'unexpectedWeights:{path.name}')


class Dino:
    def __init__(self, directory, resolution, threads):
        import torch
        from transformers import AutoImageProcessor, Dinov2Model
        from PIL import Image
        torch.set_num_threads(threads)
        torch.set_num_interop_threads(1)
        self.torch, self.Image, self.resolution = torch, Image, resolution
        self.processor = AutoImageProcessor.from_pretrained(directory, local_files_only=True, trust_remote_code=False, use_fast=False)
        self.model = Dinov2Model.from_pretrained(directory, local_files_only=True, use_safetensors=True).float().eval()
        self.name = f'DINOv2 ViT-B/14 / CLS / {resolution}px'
        self.weights_bytes = (directory/'model.safetensors').stat().st_size

    def prepare(self, paths):
        images = []
        for path in paths:
            with self.Image.open(path) as image:
                images.append(image.convert('RGB'))
        extra = {'size': {'shortest_edge': 518}, 'crop_size': {'height': 518, 'width': 518}} if self.resolution == 518 else {}
        return self.processor(images=images, return_tensors='pt', **extra)

    def infer(self, prepared):
        with self.torch.inference_mode():
            return self.model(**prepared).last_hidden_state[:, 0, :].float().cpu().numpy()


class Siglip:
    def __init__(self, directory, threads):
        import torch
        import timm
        from PIL import Image
        torch.set_num_threads(threads)
        torch.set_num_interop_threads(1)
        self.torch, self.Image = torch, Image
        config = json.loads((directory/'config.json').read_text())
        self.model = timm.create_model(config['architecture'], pretrained=False,
            pretrained_cfg=config['pretrained_cfg'], num_classes=0,
            checkpoint_path=directory/'model.safetensors').float().eval()
        self.transform_config = timm.data.resolve_model_data_config(self.model)
        self.transform = timm.data.create_transform(**self.transform_config, is_training=False)
        self.name = 'SigLIP 2 ViT-B/16 / image tower / 224px'
        self.weights_bytes = (directory/'model.safetensors').stat().st_size

    def prepare(self, paths):
        images = []
        for path in paths:
            with self.Image.open(path) as image:
                images.append(self.transform(image.convert('RGB')))
        return self.torch.stack(images)

    def infer(self, prepared):
        with self.torch.inference_mode():
            return self.model(prepared).float().cpu().numpy()


def make_encoder(name, root, threads):
    if name in ['dinov2-224', 'dinov2-518', 'siglip2']:
        key = 'dinov2' if name.startswith('dinov2') else 'siglip2'
        spec = next(row for row in json.loads(Path('scripts/benchmarks/product-photo/elfbar-models.json').read_text())['models'] if row['id'] == key)
        directory = root/'models'/key
        for file, asset in spec['files'].items():
            verify(directory/file, asset['sha256'])
        return Dino(directory, int(name.split('-')[1]), threads) if key == 'dinov2' else Siglip(directory, threads)
    baseline = Path('.local/photo-search-benchmark')
    if name == 'chinese-clip':
        verify(baseline/'models/clip_cn_vit-b-16.pt', CN_WEIGHTS_SHA256)
        return ChineseCLIP(baseline, threads)
    if name == 'ppshitu':
        directory = baseline/'models/general_PPLCNetV2_base_pretrained_v1.0_infer'
        verify(directory/'inference.pdmodel', '3e0ade05639ff7b5fe450a55883a8087dc2b5c2349fe6b73897cbe2a5eeb6ee8')
        verify(directory/'inference.pdiparams', '9f2613210c4126a2880d32108ad573a5179c0af53a0acbb5db96155f8ec2ce8d')
        return PPShiTu(baseline, threads)
    raise ValueError('unsupportedEncoder')


def normalized(encoder, paths):
    values = np.asarray(encoder.infer(encoder.prepare(paths)), dtype=np.float32)
    norms = np.linalg.norm(values, axis=1, keepdims=True)
    if values.ndim != 2 or values.shape[0] != len(paths) or not np.isfinite(values).all() or (norms < 1e-8).any():
        raise ValueError('invalidFeatures')
    return np.ascontiguousarray(values/norms)
