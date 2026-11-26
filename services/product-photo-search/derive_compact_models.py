"""Derive the two ONNX files offline from the verified PaddleClas model files.

Run with PaddlePaddle 3.3.1. --exporter-python points to a separate interpreter
with Paddle2ONNX 1.3.1 installed. No conversion dependencies are needed at runtime.
"""
import argparse
import hashlib
from importlib import import_module, metadata
from pathlib import Path
import shutil
import subprocess
import sys
from tempfile import TemporaryDirectory

from compact_weights import verify_compact_weights

DETECTOR = 'vision/picodet_PPLCNet_x2_5_mainbody_lite_v1.0_infer'
ENCODER = 'general_PPLCNetV2_base_pretrained_v1.0_infer'
SOURCE_HASHES = {
    f'{ENCODER}/inference.pdmodel': '3e0ade05639ff7b5fe450a55883a8087dc2b5c2349fe6b73897cbe2a5eeb6ee8',
    f'{ENCODER}/inference.pdiparams': '9f2613210c4126a2880d32108ad573a5179c0af53a0acbb5db96155f8ec2ce8d',
    f'{DETECTOR}/inference.pdmodel': 'aef54d49af0ed0b38334c1da9939ff8a5e2a19229f9a21147521cdf22b456280',
    f'{DETECTOR}/inference.pdiparams': 'c4bd9d61c3f8157805ee341eb9e4ac5a5e27dcdb4e05d7fc5ce50086df94cc09',
}


def verify_inputs(root):
    for relative, digest in SOURCE_HASHES.items():
        with (root / relative).open('rb') as stream:
            if hashlib.file_digest(stream, 'sha256').hexdigest() != digest:
                raise ValueError('unexpectedPaddleWeights')


def detector_heads(path):
    from paddle.base.proto import framework_pb2
    program = framework_pb2.ProgramDesc()
    program.ParseFromString(path.read_bytes())
    main = program.blocks[0]
    # The digest pins this specific export. Retain the image input, backbone and
    # heads. The loop after the heads performs decoding/NMS, supplied separately.
    assert main.ops[1].type == 'feed' and main.ops[1].outputs[0].arguments[0] == 'image'
    assert main.ops[294].type == 'while' and main.ops[297].type == 'multiclass_nms3'
    fetch = framework_pb2.OpDesc()
    fetch.CopyFrom(main.ops[300])
    del program.blocks[1:]
    del main.ops[288:]
    del main.ops[2]
    del main.ops[0]
    next(attr for attr in main.ops[0].attrs if attr.name == 'col').i = 0
    heads = [f'sigmoid_{i}.tmp_0' for i in range(4)] + [f'transpose_{i}.tmp_0' for i in (1, 3, 5, 7)]
    for index, name in enumerate(heads):
        output = main.ops.add()
        output.CopyFrom(fetch)
        output.inputs[0].arguments[0] = name
        next(attr for attr in output.attrs if attr.name == 'col').i = index
    used = {name for op in main.ops for variable in [*op.inputs, *op.outputs] for name in variable.arguments}
    for index in reversed(range(len(main.vars))):
        if main.vars[index].name not in used and not main.vars[index].persistable:
            del main.vars[index]
    return program.SerializeToString()


def export(model, parameters, output):
    distribution = metadata.distribution('paddle2onnx')
    if distribution.version != '1.3.1':
        raise ValueError('unexpectedPaddle2OnnxVersion')
    # The converter's native export accepts standalone static model files. The
    # package's Python wrapper also imports Paddle for unrelated dynamic export.
    library = next(path for path in distribution.files if path.name.startswith('paddle2onnx_cpp2py_export.'))
    sys.path.insert(0, str(distribution.locate_file(library).parent))
    converter = import_module('paddle2onnx_cpp2py_export')
    onnx = converter.export(model, parameters, 13, True, True, True, True, True, {}, 'onnxruntime', '', '', False)
    Path(output).write_bytes(onnx)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--paddle-model-root', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--exporter-python', type=Path, required=True)
    args = parser.parse_args()
    root = args.paddle_model_root.resolve()
    verify_inputs(root)
    with TemporaryDirectory(prefix='bazaar-onnx-') as temp:
        path = Path(temp)
        heads = path / 'heads.pdmodel'
        heads.write_bytes(detector_heads(root / DETECTOR / 'inference.pdmodel'))
        for model, parameters, name in [(root / ENCODER / 'inference.pdmodel', root / ENCODER / 'inference.pdiparams', 'encoder.onnx'),
                                        (heads, root / DETECTOR / 'inference.pdiparams', 'detector-heads.onnx')]:
            subprocess.run([str(args.exporter_python.absolute()), str(Path(__file__).resolve()), '--export',
                            str(model), str(parameters), str(path / name)], check=True)
        verify_compact_weights(path)
        args.output.mkdir(parents=True, exist_ok=True)
        for file in path.glob('*.onnx'):
            shutil.copyfile(file, args.output / file.name)


if __name__ == '__main__':
    if len(sys.argv) == 5 and sys.argv[1] == '--export':
        export(*sys.argv[2:])
    else:
        main()
