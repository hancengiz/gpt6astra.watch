import json
from pathlib import Path
import tempfile
import unittest

import check_astra


class FakeClient:
    def __init__(self, responses):
        self.responses = iter(responses)
        self.calls = []

    def request(self, method, params):
        self.calls.append((method, params))
        return next(self.responses)


class AstraWatchTests(unittest.TestCase):
    def test_finds_target_by_id(self):
        models = [{"id": "gpt-6-astra", "hidden": False}]
        self.assertTrue(check_astra.target_is_picker_visible(models, "gpt-6-astra"))

    def test_finds_target_by_model_field(self):
        models = [{"model": "gpt-6-astra"}]
        self.assertTrue(check_astra.target_is_picker_visible(models, "gpt-6-astra"))

    def test_ignores_hidden_target(self):
        models = [{"id": "gpt-6-astra", "hidden": True}]
        self.assertFalse(check_astra.target_is_picker_visible(models, "gpt-6-astra"))

    def test_exact_match_only(self):
        models = [{"id": "gpt-6-astra-preview", "hidden": False}]
        self.assertFalse(check_astra.target_is_picker_visible(models, "gpt-6-astra"))

    def test_model_list_pagination(self):
        client = FakeClient(
            [
                {"data": [{"id": "first"}], "nextCursor": "page-2"},
                {"data": [{"id": "second"}], "nextCursor": None},
            ]
        )

        models = check_astra.list_picker_models(client)

        self.assertEqual([{"id": "first"}, {"id": "second"}], models)
        self.assertEqual("page-2", client.calls[1][1]["cursor"])
        self.assertFalse(client.calls[0][1]["includeHidden"])

    def test_repeated_cursor_is_rejected(self):
        client = FakeClient(
            [
                {"data": [], "nextCursor": "same"},
                {"data": [], "nextCursor": "same"},
            ]
        )

        with self.assertRaises(check_astra.WatcherError):
            check_astra.list_picker_models(client)

    def test_state_round_trip_is_private(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            state_path = Path(temporary_directory) / "state" / "state.json"
            state = check_astra.default_state("gpt-6-astra")
            state["last_status"] = "absent"

            check_astra.save_state(state_path, state)

            self.assertEqual(
                state,
                check_astra.load_state(state_path, "gpt-6-astra"),
            )
            self.assertEqual(0o600, state_path.stat().st_mode & 0o777)
            json.loads(state_path.read_text(encoding="utf-8"))


    def test_country_argument_normalizes(self):
        self.assertEqual("DE", check_astra.country_argument("de"))
        self.assertEqual("TR", check_astra.country_argument(" TR "))

    def test_country_argument_rejects_invalid(self):
        import argparse

        for bad in ("tur", "T1", "d", "deu"):
            with self.assertRaises(argparse.ArgumentTypeError):
                check_astra.country_argument(bad)

    def test_report_to_map_posts_country_only(self):
        import io
        import urllib.request

        captured = {}

        class FakeResponse(io.BytesIO):
            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

        def fake_urlopen(request, timeout):
            captured["data"] = request.data
            captured["headers"] = dict(request.header_items())
            captured["timeout"] = timeout
            return FakeResponse(b'{"ok": true}')

        original = urllib.request.urlopen
        urllib.request.urlopen = fake_urlopen
        try:
            result = check_astra.report_to_map("TR", "https://example/api", 12.0)
        finally:
            urllib.request.urlopen = original

        self.assertEqual({"ok": True}, result)
        self.assertEqual(
            {"country": "TR", "source": "watcher", "nickname": ""},
            json.loads(captured["data"]),
        )
        self.assertEqual("application/json", captured["headers"]["Content-type"])
        self.assertEqual(12.0, captured["timeout"])

    def test_report_to_map_is_never_fatal(self):
        import urllib.request

        def failing_urlopen(request, timeout):
            raise OSError("network down")

        original = urllib.request.urlopen
        urllib.request.urlopen = failing_urlopen
        try:
            result = check_astra.report_to_map("TR", "https://example/api", 5.0)
        finally:
            urllib.request.urlopen = original

        self.assertIsNone(result)

if __name__ == "__main__":
    unittest.main()
