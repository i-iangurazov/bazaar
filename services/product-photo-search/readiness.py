"""Minimal process readiness; no tenant data or credentials are returned."""
import json
import math
import os
from pathlib import Path
import time


def worker_ready(environment=None, now_ms=None):
    environment = os.environ if environment is None else environment
    if environment.get("PRODUCT_PHOTO_WORKER_ENABLED") != "1":
        return True
    filename = environment.get("PRODUCT_PHOTO_WORKER_HEALTH_FILE")
    if not filename:
        return False
    try:
        path = Path(filename)
        if path.stat().st_size > 1024:
            return False
        report = json.loads(path.read_text())
        stamp = report.get("lastSuccessAt")
        now_ms = time.time() * 1000 if now_ms is None else now_ms
        return (type(stamp) in (int, float) and math.isfinite(stamp)
                and 0 <= now_ms - stamp < 90_000)
    except (OSError, ValueError, TypeError, AttributeError):
        return False
