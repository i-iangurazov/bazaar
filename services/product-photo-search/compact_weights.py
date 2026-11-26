"""Check the two FP32 ONNX graphs derived from the pinned PaddleClas weights."""
import hashlib

WEIGHTS = {
    'encoder.onnx': 'ec7a0131ab31c639a444d9b5d3efec28adb5fb0a2cfe038e1d3883ec4725af22',
    'detector-heads.onnx': '50904cd8ff629437fef7c78e8d3d2abb7d0b88e295a7e7c949a0a6a16bfc51e2',
}


def verify_compact_weights(root):
    for name, digest in WEIGHTS.items():
        with (root / name).open('rb') as stream:
            if hashlib.file_digest(stream, 'sha256').hexdigest() != digest:
                raise ValueError('unexpectedCompactWeights')
