import json
from pathlib import Path
import tempfile
import unittest
from readiness import worker_ready


class ReadinessTest(unittest.TestCase):
    def test_legacy_service_and_explicitly_disabled_indexer(self):
        self.assertTrue(worker_ready({}))
        self.assertTrue(worker_ready({"PRODUCT_PHOTO_WORKER_ENABLED": "0"}))

    def test_enabled_indexer_requires_a_successful_database_tick(self):
        self.assertFalse(worker_ready({"PRODUCT_PHOTO_WORKER_ENABLED": "1"}))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "worker.json"
            env = {"PRODUCT_PHOTO_WORKER_ENABLED": "1", "PRODUCT_PHOTO_WORKER_HEALTH_FILE": str(path)}
            self.assertFalse(worker_ready(env, 100_000))
            path.write_text(json.dumps({"lastSuccessAt": 99_000}))
            self.assertTrue(worker_ready(env, 100_000))
            self.assertFalse(worker_ready(env, 189_000))
            self.assertFalse(worker_ready(env, 98_000))

    def test_corrupt_and_unbounded_heartbeat_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "worker.json"
            env = {"PRODUCT_PHOTO_WORKER_ENABLED": "1", "PRODUCT_PHOTO_WORKER_HEALTH_FILE": str(path)}
            for content in ["not-json", "null", "[]", "{}", '{"lastSuccessAt":true}',
                            '{"lastSuccessAt":"99999"}', '{"lastSuccessAt":NaN}', "x" * 1025]:
                path.write_text(content)
                self.assertFalse(worker_ready(env, 100_000), content[:50])


if __name__ == "__main__":
    unittest.main()
