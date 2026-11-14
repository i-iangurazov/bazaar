# PP-ShiTu versus Chinese-CLIP: isolated photo retrieval benchmark

This is an offline evaluation tool, not a Bazaar feature or a marketplace client.
It never opens the application database, reads application `.env` files, or calls
DeepSeek, HioBuy, 1688, or a hosted inference API. Only preparation downloads public
source, model checkpoints and evaluation photographs. Inference uses local CPU.

## Models and source

- PP-ShiTuV2 `general_PPLCNetV2_base_pretrained_v1.0_infer`, official PaddleClas
  export, 512 features. Adapter follows `inference_general.yaml`, `predict_rec.py`
  and `deploy/utils/predictor.py` at PaddleClas commit
  `202ac79a99aa368f2c95cb1871bbc11574f685da`: RGB, bilinear resize 224×224,
  ImageNet normalization, FP32 inference. No detector is included in this test.
- Chinese-CLIP ViT-B/16, official code at
  `31863c707501bf1605d36842f43deb78793dbc5d`, checkpoint revision
  `36e679e65c2a2fead755ae21162091293ad37834`. Uses the original code's bicubic
  resize and normalization, FP32 CPU. The unused text encoder is released after
  loading; this is photo-to-photo retrieval, not image/text retrieval.
- Both return L2-normalized 512-dimensional features and use identical exact
  Faiss `IndexFlatIP` retrieval. Photos of the same object are grouped before
  product-level metrics. No model training or test-set-specific preprocessing.

The original repositories remain outside the app, under the ignored work folder.
PaddleClas code is Apache-2.0; Chinese-CLIP code is MIT. Pinning and recording model
artifacts is separate from confirming the terms of specific weights for shipping.

## Setup and execution

Run from the repository root. Tested host/runtime details are in the dated report;
do not treat macOS numbers as Linux production-server capacity.

```sh
python3.13 -m venv .local/photo-search-benchmark/venv
.local/photo-search-benchmark/venv/bin/python -m pip install -r scripts/benchmarks/product-photo/requirements.txt
.local/photo-search-benchmark/venv/bin/python scripts/benchmarks/product-photo/prepare.py models
.local/photo-search-benchmark/venv/bin/python scripts/benchmarks/product-photo/prepare.py dataset
.local/photo-search-benchmark/venv/bin/python -m unittest discover -s scripts/benchmarks/product-photo -p 'test_*.py' -v
.local/photo-search-benchmark/venv/bin/python scripts/benchmarks/product-photo/run.py
.local/photo-search-benchmark/venv/bin/python scripts/benchmarks/product-photo/report.py --results .local/photo-search-benchmark/results
```

The tested full environment is captured in `requirements-macos-arm64.lock.txt`.
Use that lock for a same-platform replay. On Linux, install CPU-only PyTorch wheels
from the official PyTorch CPU index and record a new platform lock; do not use CUDA
measurements as a CPU comparison. The default working directory needs several GB
of free disk for the venv and original checkpoints. No changes to `package.json`
or the application deployment are required.

`--root` and `--out` accept isolated work/output folders. Output must remain inside
the work root for the private retrieval executor. `--threads 1|2|4` controls math
threads per executor; `--batch-size` controls offline indexing only. Both models
run sequentially, each in a fresh process, with a 30-minute process deadline.
There is no implicit paid or accelerated fallback if a model fails.

## Public dataset protocol

[ALOI](https://aloi.science.uva.nl/aloi/description.html) contains independently
photographed objects under controlled changes of angle and illumination.
Downloads use its public JPEG previews, not generated or augmented query images.
Copyright remains with the dataset authors; images are not committed to Bazaar.

- Fixed seed `20261114` selects 300 known and 100 unknown object identities.
- Gallery: actual views `r0` and `r90` of every known object, 600 images.
- Known queries: `r30`, `r60`, `r180`, `l3c1`, `i120`, 1,500 separate images.
- Unknown queries: `r30`, `r180`, `i120`, 300 images of objects absent from gallery.
- Calibration queries: 100 known + 40 unknown identities. Test queries: the
  other 200 known + 60 unknown identities. No query identity crosses these splits.
- File hashes are recorded and verified. A query identical to a gallery file is
  excluded before any model is evaluated; excluded identifiers are recorded.
- Failed downloads prevent publication of a completed dataset manifest.
- Each model gets a rejection threshold from calibration unknowns only, targeting
  at most 5% false accepts there. The frozen threshold is evaluated on test queries.

Metrics: object Recall@1/5, MRR@20, Recall@5 confidence interval with identity-level
bootstrap, condition-specific recall, correct/wrong accepted known matches, and
false accepts of unknown objects. Raw ranking recall and thresholded acceptance
are different quantities. A similarity score is not a probability.

ALOI is a laboratory object dataset with a black background and low-resolution
previews. An object identity is not a Bazaar SKU. This experiment does not establish
performance on near-identical retail variants, phone cameras or cluttered shelves.
Pretraining overlap with all possible public images cannot be excluded. A final
shop acceptance test requires separate photographs of the intended assortment.

## Timing and resources

The test records process/model loading and first image separately from warmed
requests. Indexing is batched; user requests are batch size one. A warmed request
includes file reading, native model preprocessing/inference, normalization, private
IPC, exact retrieval and grouping. It excludes HTTP/auth/database/network work.

Faiss runs in a child process behind an inherited private socketpair. This avoids
the competing OpenMP libraries in the tested macOS PyTorch/Faiss wheels. No
`KMP_DUPLICATE_LIB_OK` workaround is used. Both models pay the same IPC overhead.
On worker failure, closing the private socket also ends the retrieval executor.

Four-client tests simulate a single serialized model executor with queued clients,
not four model copies. Response time includes queue waiting. CPU time and RSS are
sampled across both processes; 100% CPU means one core. Aggregate RSS can count
shared library pages twice. Model load and indexing peaks are reported separately
from query phases. Memory sampling interval is 20 ms, not a hard peak guarantee.

The 1k/10k/50k index test uses seeded **synthetic vectors**, solely to measure
index memory and exact-search cost. It provides no evidence of recall at those
catalog sizes. Neither OS caches nor other applications on the host are controlled.

## Outputs and replay

`model-assets.json` records original URLs, sizes and checksums. `dataset.json`
records source URLs, image dimensions, hashes, splits and labels. Results include
host/runtime versions, dataset and harness hashes, per-phase CPU/RSS, latency
distributions, concurrency and scale measurements. Per-query matches, timings and
feature arrays stay under the ignored work root for error analysis and replay.
`report.py` verifies matching source/data fingerprints before exporting compact
JSON evidence and a compressed image manifest; it never republishes the photos.

To use a later authorized Bazaar sample, prepare an equivalent `dataset.json`
and images under a separate isolated root. Provide real product labels, disjoint
query photos and calibration/test identities; mark absent products unknown. Do not
fill the live database, copy customer pictures into git, or reuse public laboratory
scores as that sample's measured accuracy.
