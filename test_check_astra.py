import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock, patch

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

    def test_send_watcher_event_posts_protocol_payload(self):
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
            result = check_astra.send_watcher_event(
                "TR",
                "random-installation-id-123456",
                "heartbeat",
                "https://example/api",
                12.0,
            )
        finally:
            urllib.request.urlopen = original

        self.assertEqual({"ok": True}, result)
        self.assertEqual(
            {
                "country": "TR",
                "watcher_id": "random-installation-id-123456",
                "event": "heartbeat",
                "mode": "account",
                "nickname": "",
            },
            json.loads(captured["data"]),
        )
        self.assertEqual("application/json", captured["headers"]["Content-type"])
        self.assertEqual(
            "Astra-Watch/1.0 (+https://gpt6astra.watch)",
            captured["headers"]["User-agent"],
        )
        self.assertEqual(12.0, captured["timeout"])

    def test_send_watcher_event_is_never_fatal(self):
        import urllib.request

        def failing_urlopen(request, timeout):
            raise OSError("network down")

        original = urllib.request.urlopen
        urllib.request.urlopen = failing_urlopen
        try:
            result = check_astra.send_watcher_event(
                "TR",
                "random-installation-id-123456",
                "access",
                "https://example/api",
                5.0,
            )
        finally:
            urllib.request.urlopen = original

        self.assertIsNone(result)

    def test_successful_absent_check_sends_waiting_after_heartbeat(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            args = check_astra.parse_args([
                "--force",
                "--share-country", "UA",
                "--state-file", str(Path(temporary_directory) / "state.json"),
            ])
            fake_context = MagicMock()
            fake_context.__enter__.return_value = object()
            with (
                patch.object(check_astra, "resolve_codex_binary", return_value="codex"),
                patch.object(check_astra, "AppServerClient", return_value=fake_context),
                patch.object(check_astra, "list_picker_models", return_value=[]),
                patch.object(check_astra, "send_watcher_event", return_value={"ok": True}) as send,
                patch.object(check_astra, "print_result"),
            ):
                result = check_astra.check_once(args)

        self.assertEqual(0, result)
        self.assertEqual(["heartbeat", "waiting"], [call.args[2] for call in send.call_args_list])

    def test_failed_check_never_sends_waiting(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            args = check_astra.parse_args([
                "--force",
                "--share-country", "UA",
                "--state-file", str(Path(temporary_directory) / "state.json"),
            ])
            with (
                patch.object(
                    check_astra, "resolve_codex_binary",
                    side_effect=check_astra.WatcherError("catalog unavailable"),
                ),
                patch.object(check_astra, "send_watcher_event", return_value={"ok": True}) as send,
                patch.object(check_astra, "print_result"),
            ):
                result = check_astra.check_once(args)

        self.assertEqual(1, result)
        self.assertEqual(["heartbeat"], [call.args[2] for call in send.call_args_list])

    def test_no_notify_smoke_check_suppresses_waiting_signal(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            args = check_astra.parse_args([
                "--force",
                "--no-notify",
                "--share-country", "UA",
                "--state-file", str(Path(temporary_directory) / "state.json"),
            ])
            fake_context = MagicMock()
            fake_context.__enter__.return_value = object()
            with (
                patch.object(check_astra, "resolve_codex_binary", return_value="codex"),
                patch.object(check_astra, "AppServerClient", return_value=fake_context),
                patch.object(check_astra, "list_picker_models", return_value=[]),
                patch.object(check_astra, "send_watcher_event") as send,
                patch.object(check_astra, "print_result"),
            ):
                result = check_astra.check_once(args)

        self.assertEqual(0, result)
        send.assert_not_called()

    def test_private_funnel_does_not_multiply_skill_requests_by_installations(self):
        import sqlite3

        database = sqlite3.connect(":memory:")
        schema = (Path(__file__).parent / "site" / "schema.sql").read_text()
        database.executescript(schema)
        database.execute(
            "INSERT INTO skill_requests "
            "(country, ip_hash, first_requested_at, last_requested_at, request_count) "
            "VALUES ('TR', 'same-ip', 1, 2, 2)"
        )
        database.executemany(
            "INSERT INTO watchers "
            "(country, watcher_hash, ip_hash, mode, started_at, last_seen_at, "
            "completed_at, access_detected_at, completion_reason, created_at) "
            "VALUES (?, ?, 'same-ip', 'account', 1, 2, ?, ?, ?, 1)",
            [
                ("TR", "watcher-one", 2, 2, "account_access"),
                ("TR", "watcher-two", None, None, None),
            ],
        )

        row = database.execute(
            "SELECT skill_requests, unique_skill_requesters, watcher_installations, "
            "completed_watchers, account_accesses FROM internal_funnel"
        ).fetchone()

        self.assertEqual((2, 1, 2, 1, 1), row)

    def test_report_undo_migration_preserves_legacy_rows(self):
        import sqlite3

        database = sqlite3.connect(":memory:")
        database.executescript(
            """
            CREATE TABLE reports (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              country TEXT NOT NULL,
              source TEXT NOT NULL,
              ip_hash TEXT NOT NULL,
              created_at INTEGER NOT NULL
            );
            INSERT INTO reports (country, source, ip_hash, created_at) VALUES
              ('TR', 'web', 'shared-ip', 1),
              ('TR', 'web', 'shared-ip', 2),
              ('US', 'watcher', 'watcher-id', 3);
            """
        )
        before = database.execute(
            "SELECT id, country, source, ip_hash, created_at FROM reports ORDER BY id"
        ).fetchall()

        migration = (
            Path(__file__).parent / "site" / "migrations" / "0003_report_undo.sql"
        ).read_text()
        database.executescript(migration)

        after = database.execute(
            "SELECT id, country, source, ip_hash, created_at FROM reports ORDER BY id"
        ).fetchall()
        claims = database.execute(
            "SELECT ip_hash, country FROM report_claims"
        ).fetchall()
        self.assertEqual(before, after)
        self.assertEqual([("shared-ip", "TR")], claims)

    def test_waiting_vote_migration_is_additive_and_idempotent(self):
        import sqlite3

        database = sqlite3.connect(":memory:")
        database.executescript(
            """
            CREATE TABLE reports (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              country TEXT NOT NULL,
              source TEXT NOT NULL,
              ip_hash TEXT NOT NULL,
              undo_hash TEXT,
              created_at INTEGER NOT NULL
            );
            CREATE TABLE report_claims (
              ip_hash TEXT NOT NULL,
              country TEXT NOT NULL,
              created_at INTEGER NOT NULL,
              PRIMARY KEY (ip_hash, country)
            );
            CREATE TABLE watchers (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              country TEXT NOT NULL,
              watcher_hash TEXT,
              ip_hash TEXT NOT NULL,
              created_at INTEGER NOT NULL
            );
            CREATE TABLE skill_requests (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              country TEXT NOT NULL,
              ip_hash TEXT NOT NULL,
              first_requested_at INTEGER NOT NULL,
              last_requested_at INTEGER NOT NULL,
              request_count INTEGER NOT NULL
            );
            INSERT INTO reports
              (country, source, ip_hash, undo_hash, created_at)
              VALUES ('TR', 'web', 'report-ip', 'undo-hash', 10);
            INSERT INTO report_claims (ip_hash, country, created_at)
              VALUES ('report-ip', 'TR', 10);
            INSERT INTO watchers (country, watcher_hash, ip_hash, created_at)
              VALUES ('DE', 'watcher-hash', 'watcher-ip', 20);
            INSERT INTO skill_requests
              (country, ip_hash, first_requested_at, last_requested_at, request_count)
              VALUES ('GB', 'skill-ip', 30, 40, 2);
            """
        )
        tables = ("reports", "report_claims", "watchers", "skill_requests")
        before = {
            table: database.execute(f"SELECT * FROM {table}").fetchall()
            for table in tables
        }
        migration = (
            Path(__file__).parent / "site" / "migrations" / "0004_waiting_votes.sql"
        ).read_text()

        database.executescript(migration)
        database.executescript(migration)

        after = {
            table: database.execute(f"SELECT * FROM {table}").fetchall()
            for table in tables
        }
        self.assertEqual(before, after)
        self.assertEqual(
            "waiting_votes",
            database.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='waiting_votes'"
            ).fetchone()[0],
        )

    def test_watcher_waiting_migration_preserves_existing_rows(self):
        import sqlite3

        database = sqlite3.connect(":memory:")
        database.executescript(
            """
            CREATE TABLE watchers (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              country TEXT NOT NULL,
              watcher_hash TEXT NOT NULL,
              ip_hash TEXT NOT NULL,
              mode TEXT NOT NULL CHECK (mode IN ('account','region')),
              started_at INTEGER NOT NULL,
              last_seen_at INTEGER NOT NULL,
              completed_at INTEGER,
              access_detected_at INTEGER,
              completion_reason TEXT,
              created_at INTEGER NOT NULL
            );
            INSERT INTO watchers (
              country, watcher_hash, ip_hash, mode, started_at, last_seen_at,
              completed_at, access_detected_at, completion_reason, created_at
            ) VALUES ('UA', 'existing-watcher', 'existing-ip', 'account',
                      10, 20, NULL, NULL, NULL, 10);
            """
        )
        before = database.execute(
            "SELECT id, country, watcher_hash, ip_hash, mode, started_at, "
            "last_seen_at, completed_at, access_detected_at, completion_reason, created_at "
            "FROM watchers"
        ).fetchall()

        migration = (
            Path(__file__).parent / "site" / "migrations" / "0005_watcher_waiting.sql"
        ).read_text()
        database.executescript(migration)

        after = database.execute(
            "SELECT id, country, watcher_hash, ip_hash, mode, started_at, "
            "last_seen_at, completed_at, access_detected_at, completion_reason, created_at "
            "FROM watchers"
        ).fetchall()
        added = database.execute(
            "SELECT last_waiting_at, response_hash FROM watchers"
        ).fetchone()
        index = database.execute(
            "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_watchers_waiting'"
        ).fetchone()

        self.assertEqual(before, after)
        self.assertEqual((None, None), added)
        self.assertEqual(("idx_watchers_waiting",), index)

if __name__ == "__main__":
    unittest.main()
