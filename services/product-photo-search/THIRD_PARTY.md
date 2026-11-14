# Sources for the local photo pipeline

No paid inference API is used. Model files stay outside git; installation is explicit,
and runtime reads pinned local files without downloading replacements.

| Component | Source | License / use in Bazaar |
| --- | --- | --- |
| PP-ShiTuV2 encoder, PicoDet mainbody detector and preprocessing | [PaddleClas 202ac79](https://github.com/PaddlePaddle/PaddleClas/tree/202ac79a99aa368f2c95cb1871bbc11574f685da), [mainbody documentation](https://github.com/PaddlePaddle/PaddleClas/blob/202ac79a99aa368f2c95cb1871bbc11574f685da/docs/en/image_recognition_pipeline/mainbody_detection_en.md) | Apache-2.0. `vision.py` adapts bounded preprocessing/inference, preserving attribution. |
| PP-OCRv6 detector/recognizer, direction classifier | Baidu/PaddleOCR models converted by [RapidAI/RapidOCR](https://github.com/RapidAI/RapidOCR), [pinned model identities](https://github.com/RapidAI/RapidOCR/blob/v3.9.2/python/rapidocr/default_models.yaml) | Upstream identifies Baidu as model copyright holder and declares Apache-2.0; converted artifacts retain upstream model terms. |
| RapidOCR 3.9.2 | [Source and license](https://github.com/RapidAI/RapidOCR/tree/v3.9.2) | Apache-2.0; called through its existing detector, rectification and recognizer APIs. |
| ONNX Runtime 1.29.0 | [Microsoft](https://github.com/microsoft/onnxruntime) | MIT; CPU execution provider, limited threads. |
| Faiss 1.16.0 | [Meta](https://github.com/facebookresearch/faiss) | MIT; existing stateless private executor. |
| react-easy-crop | Existing Bazaar dependency, [source](https://github.com/ValentinH/react-easy-crop) | MIT; user-controlled region selection, no new browser dependency. |

The Apache-2.0 text is included in [licenses/Apache-2.0.txt](licenses/Apache-2.0.txt).
Weights and archive checksums are in [vision-models.json](vision-models.json).
The recognizer uses the pinned PP-OCRv6 **medium** ONNX artifact from RapidOCR 3.9.2;
the small detector and direction classifier remain unchanged. The explicit installer
downloads and verifies medium; inference never downloads or falls back to an API.
No model-specific ELFBAR training or flavor list is added.

`pipeline.py` adapts the multi-region recognition method in PaddleClas
[`SystemPredictor.predict`](https://github.com/PaddlePaddle/PaddleClas/blob/202ac79a99aa368f2c95cb1871bbc11574f685da/deploy/python/predict_system.py)
(Copyright (c) 2021 PaddlePaddle Authors, Apache-2.0): recognize detector proposals
and the full image, retain recognition evidence. Bazaar caps this at six views,
merges product candidates rather than accepting a top-one SKU, and uses one
stateless batched Faiss request. Detector threshold 0.2 / five proposals follow the
pinned official configuration; Bazaar's separate retrieval threshold stays 0.68.
