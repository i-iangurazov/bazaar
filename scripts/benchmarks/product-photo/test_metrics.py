import copy
import unittest

from metrics import rejection_threshold, summarize, unique_products, validate_manifest


class RetrievalProtocolTests(unittest.TestCase):
    def test_multiple_photos_cannot_fill_the_product_top_five(self):
        gallery = [{"product_id": "a", "id": "a-1"}, {"product_id": "a", "id": "a-2"},
                   {"product_id": "b", "id": "b-1"}, {"product_id": "c", "id": "c-1"}]
        result = unique_products([0.99, 0.98, 0.9, 0.8], [0, 1, 2, 3], gallery)
        self.assertEqual([row["product_id"] for row in result], ["a", "b", "c"])
        self.assertEqual(result[0]["image_id"], "a-1")

    def test_rejection_threshold_rejects_ties_and_respects_budget(self):
        for scores in [[0.5]*100, list(range(100)), [0.3]*95+[0.9]*5]:
            threshold = rejection_threshold(scores)
            self.assertLessEqual(sum(score >= threshold for score in scores)/len(scores), 0.05)
        with self.assertRaises(ValueError):
            rejection_threshold([])
        with self.assertRaises(ValueError):
            rejection_threshold([float("nan")])

    def test_known_retrieval_and_unknown_false_accepts_are_separate(self):
        rows = [
            {"product_id": "a", "known": True, "condition": "r30", "matches": [
                {"product_id": "b", "score": 0.9}, {"product_id": "a", "score": 0.85}]},
            {"product_id": "c", "known": True, "condition": "r30", "matches": [
                {"product_id": "c", "score": 0.8}]},
            {"product_id": "unknown", "known": False, "condition": "r30", "matches": [
                {"product_id": "b", "score": 0.92}]},
        ]
        result = summarize(rows, threshold=0.85)
        self.assertEqual(result["recall_at_1"], 0.5)
        self.assertEqual(result["recall_at_5"], 1)
        self.assertEqual(result["mrr_at_20"], 0.75)
        self.assertEqual(result["accepted_correct_top1_rate"], 0)
        self.assertEqual(result["accepted_wrong_top1_rate"], 0.5)
        self.assertEqual(result["unknown_false_accept_rate"], 1)

    def manifest(self):
        return {"entries": [
            {"id": "a-gallery", "product_id": "a", "known": True, "split": "gallery", "sha256": "1"},
            {"id": "b-gallery", "product_id": "b", "known": True, "split": "gallery", "sha256": "2"},
            {"id": "a-query", "product_id": "a", "known": True, "split": "calibration", "sha256": "3"},
            {"id": "b-query", "product_id": "b", "known": True, "split": "test", "sha256": "4"},
            {"id": "c-query", "product_id": "c", "known": False, "split": "calibration", "sha256": "5"},
            {"id": "d-query", "product_id": "d", "known": False, "split": "test", "sha256": "6"},
        ]}

    def test_self_match_leakage_is_rejected(self):
        manifest = self.manifest()
        validate_manifest(manifest)
        manifest["entries"][2]["sha256"] = "1"
        with self.assertRaisesRegex(ValueError, "leakage"):
            validate_manifest(manifest)

    def test_calibration_cannot_see_test_product_identities(self):
        manifest = self.manifest()
        manifest["entries"][3]["product_id"] = "a"
        with self.assertRaisesRegex(ValueError, "identities overlap"):
            validate_manifest(manifest)

    def test_unknown_object_in_gallery_is_rejected(self):
        manifest = self.manifest()
        manifest["entries"].append({"id": "c-gallery", "product_id": "c", "known": True,
                                    "split": "gallery", "sha256": "7"})
        with self.assertRaisesRegex(ValueError, "ground truth"):
            validate_manifest(manifest)


if __name__ == "__main__":
    unittest.main()
