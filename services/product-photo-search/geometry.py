"""Bounds shared by display regions and every image backend."""
import math


def valid_region(region):
    if not isinstance(region, dict) or set(region) != {'x', 'y', 'width', 'height'}:
        return False
    if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in region.values()):
        return False
    x, y, width, height = (region[key] for key in ('x', 'y', 'width', 'height'))
    return (0 <= x < 1 and 0 <= y < 1 and 0 < width <= 1 and 0 < height <= 1
            and x + width <= 1.000001 and y + height <= 1.000001)


def crop_region(image, region):
    if not valid_region(region):
        raise ValueError('invalidRegion')
    h, w = image.shape[:2]
    x, y = int(region['x'] * w), int(region['y'] * h)
    right = min(w, math.ceil((region['x'] + region['width']) * w))
    bottom = min(h, math.ceil((region['y'] + region['height']) * h))
    if right - x < 4 or bottom - y < 4:
        raise ValueError('invalidRegion')
    return image[y:bottom, x:right].copy()


def fallback_analysis(region=None):
    return {'regionSource': 'manual' if region else 'full', 'region': region,
            'ocrStatus': 'unavailable', 'lines': []}
