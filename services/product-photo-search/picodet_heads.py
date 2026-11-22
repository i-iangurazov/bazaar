# Copyright (c) 2021 PaddlePaddle Authors. Licensed under Apache-2.0.
# Adapted from PaddleDetection deploy/python/picodet_postprocess.py at b25522a0.
# The frozen mainbody graph has one class, a 640px input, and a batch of one.
"""Decode the same PicoDet scores and boxes removed for the ONNX export."""
import numpy as np


def intersection_over_union(boxes, box):
    overlap = np.maximum(0, np.minimum(boxes[:, 2:], box[2:]) - np.maximum(boxes[:, :2], box[:2]))
    sides = np.maximum(0, boxes[:, 2:] - boxes[:, :2])
    box_sides = np.maximum(0, box[2:] - box[:2])
    area = overlap.prod(axis=1)
    return area / (sides.prod(axis=1) + box_sides.prod() - area + 1e-5)


def suppress(boxes, scores):
    remaining = np.argsort(scores)[-1000:]
    keep = []
    while len(remaining):
        last = remaining[-1]
        keep.append(last)
        if len(keep) == 100:
            break
        rest = remaining[:-1]
        remaining = rest[intersection_over_union(boxes[rest], boxes[last]) <= 0.6]
    return keep


def decode_heads(outputs, scale):
    all_boxes, all_scores = [], []
    for stride, scores, regression in zip((8, 16, 32, 64), outputs[:4], outputs[4:], strict=True):
        scores = scores.reshape(-1)
        centers = (np.arange(640 // stride) + 0.5) * stride
        x, y = np.meshgrid(centers, centers)
        center = np.stack((x.flatten(), y.flatten(), x.flatten(), y.flatten()), axis=1)
        logits = regression.reshape(-1, 8)
        exp = np.exp(logits - logits.max(axis=1, keepdims=True))
        probs = exp / exp.sum(axis=1, keepdims=True)
        distance = (probs * np.arange(8)).sum(axis=1).reshape(-1, 4) * stride
        order = np.argsort(scores)[::-1][:1000]
        all_boxes.append((center[order] + distance[order] * [-1, -1, 1, 1]).clip(0, 640))
        all_scores.append(scores[order])
    boxes = np.concatenate(all_boxes)
    scores = np.concatenate(all_scores)
    selected = scores > 0.025
    boxes, scores = boxes[selected], scores[selected]
    keep = suppress(boxes, scores)
    boxes = boxes[keep].astype(np.float32) / np.tile(scale[::-1], 2)
    return np.column_stack((np.zeros(len(keep), np.float32), scores[keep], boxes))
