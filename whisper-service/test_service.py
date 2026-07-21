import unittest
import service


class ServiceContractTests(unittest.TestCase):
    def test_supported_models_are_english_only(self):
        self.assertEqual(service.ALLOWED_MODELS, {"tiny.en", "base.en", "small.en"})

    def test_public_job_removes_internal_fields(self):
        result = service.public_job({"id": "1", "status": "queued", "cancel": object(), "temp_path": "secret"})
        self.assertEqual(result, {"id": "1", "status": "queued"})


if __name__ == "__main__":
    unittest.main()
