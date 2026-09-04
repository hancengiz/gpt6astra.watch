#!/usr/bin/env python3
"""Watch the authenticated Codex model picker for GPT-6 Astra."""

from __future__ import annotations

import argparse
from collections import deque
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import queue
import secrets
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from typing import Any
import urllib.request


DEFAULT_MODEL = "gpt-6-astra"
DEFAULT_TIMEOUT_SECONDS = 30.0
DEFAULT_WATCHER_URL = "https://gpt6astra.watch/api/watchers"
STATE_VERSION = 2


class WatcherError(RuntimeError):
    """Raised when the watcher cannot obtain a trustworthy result."""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def default_state(target_model: str) -> dict[str, Any]:
    return {
        "version": STATE_VERSION,
        "target_model": target_model,
        "last_status": "never_checked",
        "last_checked_at": None,
        "available_since": None,
        "notified_at": None,
        "consecutive_errors": 0,
        "error_notification_sent": False,
        "last_error": None,
        "watcher_id": None,
    }


def default_state_path() -> Path:
    state_root = Path(
        os.environ.get("XDG_STATE_HOME", Path.home() / ".local" / "state")
    )
    return state_root / "astra-watch" / "state.json"


def load_state(path: Path, target_model: str) -> dict[str, Any]:
    if not path.exists():
        return default_state(target_model)

    try:
        loaded = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise WatcherError(f"cannot read state file {path}: {exc}") from exc

    if not isinstance(loaded, dict):
        raise WatcherError(f"state file {path} does not contain a JSON object")

    if loaded.get("target_model") != target_model:
        return default_state(target_model)

    state = default_state(target_model)
    state.update(loaded)
    state["version"] = STATE_VERSION
    return state


def save_state(path: Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(path.parent, 0o700)

    temporary_name: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            delete=False,
        ) as temporary:
            temporary_name = temporary.name
            json.dump(state, temporary, indent=2, sort_keys=True)
            temporary.write("\n")
            temporary.flush()
            os.fsync(temporary.fileno())
        os.chmod(temporary_name, 0o600)
        os.replace(temporary_name, path)
    finally:
        if temporary_name and os.path.exists(temporary_name):
            os.unlink(temporary_name)


def resolve_codex_binary(explicit: str | None = None) -> str:
    requested = explicit or os.environ.get("ASTRA_WATCH_CODEX_BIN")
    if requested:
        candidate = Path(requested).expanduser()
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return str(candidate)
        raise WatcherError(f"Codex executable is not runnable: {candidate}")

    discovered = shutil.which("codex")
    if discovered:
        return discovered

    mise_candidate = (
        Path.home() / ".local" / "share" / "mise" / "installs" / "codex" / "latest" / "bin" / "codex"
    )
    if mise_candidate.is_file() and os.access(mise_candidate, os.X_OK):
        return str(mise_candidate)

    raise WatcherError(
        "could not find the Codex executable; set ASTRA_WATCH_CODEX_BIN"
    )


class AppServerClient:
    """Minimal JSONL client for the stable Codex App Server protocol."""

    _END_OF_STREAM = object()

    def __init__(self, codex_binary: str, timeout: float) -> None:
        self.codex_binary = codex_binary
        self.timeout = timeout
        self.process: subprocess.Popen[str] | None = None
        self.messages: queue.Queue[object] = queue.Queue()
        self.pending: dict[int, dict[str, Any]] = {}
        self.stderr_tail: deque[str] = deque(maxlen=20)
        self.next_request_id = 1

    def __enter__(self) -> "AppServerClient":
        try:
            self.process = subprocess.Popen(
                [self.codex_binary, "app-server"],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
            )
        except OSError as exc:
            raise WatcherError(f"could not start Codex App Server: {exc}") from exc

        threading.Thread(target=self._read_stdout, daemon=True).start()
        threading.Thread(target=self._read_stderr, daemon=True).start()

        try:
            self.request(
                "initialize",
                {
                    "clientInfo": {
                        "name": "astra_watcher",
                        "title": "Astra Watcher",
                        "version": "1.0.0",
                    }
                },
            )
            self.notify("initialized", {})
        except Exception:
            self.close()
            raise
        return self

    def __exit__(self, _exc_type: object, _exc: object, _traceback: object) -> None:
        self.close()

    def _read_stdout(self) -> None:
        assert self.process is not None and self.process.stdout is not None
        try:
            for raw_line in self.process.stdout:
                line = raw_line.strip()
                if not line:
                    continue
                try:
                    message = json.loads(line)
                except json.JSONDecodeError as exc:
                    self.messages.put(
                        WatcherError(f"invalid JSON from Codex App Server: {exc}")
                    )
                    continue
                self.messages.put(message)
        finally:
            self.messages.put(self._END_OF_STREAM)

    def _read_stderr(self) -> None:
        assert self.process is not None and self.process.stderr is not None
        for raw_line in self.process.stderr:
            line = raw_line.rstrip()
            if line:
                self.stderr_tail.append(line)

    def _send(self, message: dict[str, Any]) -> None:
        assert self.process is not None and self.process.stdin is not None
        if self.process.poll() is not None:
            raise WatcherError(self._process_exit_message())
        try:
            self.process.stdin.write(
                json.dumps(message, separators=(",", ":")) + "\n"
            )
            self.process.stdin.flush()
        except (BrokenPipeError, OSError) as exc:
            raise WatcherError(self._process_exit_message(str(exc))) from exc

    def notify(self, method: str, params: dict[str, Any]) -> None:
        self._send({"method": method, "params": params})

    def request(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        request_id = self.next_request_id
        self.next_request_id += 1
        self._send({"method": method, "id": request_id, "params": params})

        if request_id in self.pending:
            return self._unwrap_response(self.pending.pop(request_id))

        deadline = time.monotonic() + self.timeout
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise WatcherError(
                    f"timed out waiting for Codex App Server method {method}"
                )
            try:
                item = self.messages.get(timeout=remaining)
            except queue.Empty as exc:
                raise WatcherError(
                    f"timed out waiting for Codex App Server method {method}"
                ) from exc

            if item is self._END_OF_STREAM:
                raise WatcherError(self._process_exit_message())
            if isinstance(item, Exception):
                raise item
            if not isinstance(item, dict):
                continue

            response_id = item.get("id")
            if response_id == request_id:
                return self._unwrap_response(item)
            if isinstance(response_id, int):
                self.pending[response_id] = item

    @staticmethod
    def _unwrap_response(message: dict[str, Any]) -> dict[str, Any]:
        error = message.get("error")
        if error:
            if isinstance(error, dict):
                detail = error.get("message") or json.dumps(error, sort_keys=True)
            else:
                detail = str(error)
            raise WatcherError(f"Codex App Server error: {detail}")

        result = message.get("result")
        if not isinstance(result, dict):
            raise WatcherError("Codex App Server response is missing an object result")
        return result

    def _process_exit_message(self, extra: str | None = None) -> str:
        details = list(self.stderr_tail)
        if extra:
            details.append(extra)
        suffix = f": {' | '.join(details)}" if details else ""
        code = self.process.poll() if self.process is not None else None
        return f"Codex App Server exited unexpectedly (status {code}){suffix}"

    def close(self) -> None:
        if self.process is None:
            return
        if self.process.stdin is not None and not self.process.stdin.closed:
            try:
                self.process.stdin.close()
            except OSError:
                pass
        try:
            self.process.wait(timeout=1)
        except subprocess.TimeoutExpired:
            self.process.terminate()
            try:
                self.process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=2)


def list_picker_models(client: AppServerClient) -> list[dict[str, Any]]:
    models: list[dict[str, Any]] = []
    cursor: str | None = None
    seen_cursors: set[str] = set()

    while True:
        params: dict[str, Any] = {"limit": 100, "includeHidden": False}
        if cursor is not None:
            params["cursor"] = cursor

        result = client.request("model/list", params)
        page = result.get("data")
        if not isinstance(page, list) or not all(
            isinstance(item, dict) for item in page
        ):
            raise WatcherError("model/list returned invalid model data")
        models.extend(page)

        next_cursor = result.get("nextCursor")
        if next_cursor is None:
            return models
        if not isinstance(next_cursor, str) or not next_cursor:
            raise WatcherError("model/list returned an invalid pagination cursor")
        if next_cursor in seen_cursors:
            raise WatcherError("model/list repeated a pagination cursor")
        seen_cursors.add(next_cursor)
        cursor = next_cursor


def target_is_picker_visible(models: list[dict[str, Any]], target: str) -> bool:
    return any(
        item.get("hidden") is not True
        and (item.get("id") == target or item.get("model") == target)
        for item in models
    )


def send_desktop_notification(title: str, body: str, urgency: str) -> None:
    notifier = shutil.which("notify-send")
    command: list[str]
    if notifier is not None:
        command = [
            notifier,
            "--app-name=Astra Watch",
            f"--urgency={urgency}",
            "--icon=dialog-information",
            title,
            body,
        ]
    elif sys.platform == "darwin" and (osascript := shutil.which("osascript")):
        apple_title = title.replace("\\", "\\\\").replace('"', '\\"')
        apple_body = body.replace("\\", "\\\\").replace('"', '\\"')
        command = [
            osascript,
            "-e",
            f'display notification "{apple_body}" with title "{apple_title}"',
        ]
    elif os.name == "nt" and (
        powershell := shutil.which("powershell.exe") or shutil.which("pwsh")
    ):
        ps_title = title.replace("'", "''")
        ps_body = body.replace("'", "''")
        command = [
            powershell,
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Add-Type -AssemblyName PresentationFramework;"
            f"[System.Windows.MessageBox]::Show('{ps_body}','{ps_title}') | Out-Null",
        ]
    else:
        raise WatcherError(
            "no supported desktop notifier found "
            "(notify-send on Linux, osascript on macOS, PowerShell on Windows)"
        )

    try:
        completed = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
            timeout=10,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise WatcherError(f"desktop notification failed: {exc}") from exc

    if completed.returncode != 0:
        detail = completed.stderr.strip() or f"status {completed.returncode}"
        raise WatcherError(f"desktop notification failed: {detail}")


def print_result(payload: dict[str, Any], *, error: bool = False) -> None:
    print(
        json.dumps(payload, separators=(",", ":"), sort_keys=True),
        file=sys.stderr if error else sys.stdout,
    )


def send_watcher_event(
    country: str,
    watcher_id: str,
    event: str,
    endpoint: str,
    timeout: float,
    *,
    mode: str = "account",
) -> dict[str, Any] | None:
    """Best-effort anonymous watcher signal. Never raises."""
    payload = json.dumps(
        {
            "country": country,
            "watcher_id": watcher_id,
            "event": event,
            "mode": mode,
            "nickname": "",
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        endpoint,
        data=payload,
        headers={
            "content-type": "application/json",
            "user-agent": "Astra-Watch/1.0 (+https://gpt6astra.watch)",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read(4096)
    except OSError as exc:
        print_result(
            {"status": "watcher_signal_failed", "event": event, "error": str(exc)},
            error=True,
        )
        return None
    try:
        decoded = json.loads(body)
    except json.JSONDecodeError:
        return None
    return decoded if isinstance(decoded, dict) else None


def check_once(args: argparse.Namespace) -> int:
    checked_at = utc_now()
    state_path = Path(args.state_file).expanduser()
    state = load_state(state_path, args.model)

    if state.get("notified_at") and not args.force:
        print_result(
            {
                "status": "already_notified",
                "model": args.model,
                "available_since": state.get("available_since"),
                "notified_at": state.get("notified_at"),
            }
        )
        return 0
    monitoring_signal = None
    watcher_id = state.get("watcher_id")
    if args.share_country and not args.no_notify:
        if not watcher_id:
            watcher_id = secrets.token_urlsafe(24)
            state["watcher_id"] = watcher_id
            save_state(state_path, state)
        monitoring_signal = send_watcher_event(
            args.share_country,
            watcher_id,
            "heartbeat",
            args.watcher_url,
            min(args.timeout, 15.0),
        )


    try:
        codex_binary = resolve_codex_binary(args.codex_bin)
        with AppServerClient(codex_binary, args.timeout) as client:
            models = list_picker_models(client)
        available = target_is_picker_visible(models, args.model)
    except (WatcherError, OSError) as exc:
        state["last_status"] = "error"
        state["last_checked_at"] = checked_at
        state["last_error"] = str(exc)
        state["consecutive_errors"] = int(state.get("consecutive_errors", 0)) + 1

        if (
            state["consecutive_errors"] >= 3
            and not state.get("error_notification_sent")
            and not args.no_notify
        ):
            try:
                send_desktop_notification(
                    "Astra Watch needs attention",
                    "Three consecutive checks failed. Run check_astra.py manually for details.",
                    "normal",
                )
            except WatcherError as notification_error:
                state["last_error"] = f"{exc}; {notification_error}"
            else:
                state["error_notification_sent"] = True

        save_state(state_path, state)
        print_result(
            {
                "status": "error",
                "model": args.model,
                "checked_at": checked_at,
                "consecutive_errors": state["consecutive_errors"],
                "error": state["last_error"],
            },
            error=True,
        )
        return 1

    state["last_checked_at"] = checked_at
    state["last_error"] = None
    state["consecutive_errors"] = 0
    state["error_notification_sent"] = False

    if not available:
        state["last_status"] = "absent"
        state["available_since"] = None
        waiting_signal = None
        if args.share_country and not args.no_notify:
            waiting_signal = send_watcher_event(
                args.share_country,
                watcher_id,
                "waiting",
                args.watcher_url,
                min(args.timeout, 15.0),
            )
        save_state(state_path, state)
        print_result(
            {
                "status": "absent",
                "model": args.model,
                "checked_at": checked_at,
                "picker_models_seen": len(models),
                "monitoring_signal": monitoring_signal,
                "waiting_signal": waiting_signal,
            }
        )
        return 0

    state["last_status"] = "available"
    state["available_since"] = state.get("available_since") or checked_at

    if args.no_notify:
        save_state(state_path, state)
        print_result(
            {
                "status": "available",
                "model": args.model,
                "checked_at": checked_at,
                "notification": "suppressed",
                "sharing": "suppressed" if args.share_country else None,
            }
        )
        return 0
    access_signal = None
    if args.share_country:
        access_signal = send_watcher_event(
            args.share_country,
            watcher_id,
            "access",
            args.watcher_url,
            min(args.timeout, 15.0),
        )


    try:
        send_desktop_notification(
            "GPT-6 Astra is available",
            "gpt-6-astra is now visible in the model catalog for your Codex account.",
            "critical",
        )
    except WatcherError as exc:
        state["last_error"] = str(exc)
        save_state(state_path, state)
        print_result(
            {
                "status": "available_notification_failed",
                "model": args.model,
                "checked_at": checked_at,
                "error": str(exc),
            },
            error=True,
        )
        return 1


    state["notified_at"] = checked_at
    save_state(state_path, state)
    print_result(
        {
            "status": "available",
            "model": args.model,
            "checked_at": checked_at,
            "notification": "sent",
            "access_signal": access_signal,
        }
    )
    return 0


def country_argument(value: str) -> str:
    candidate = value.strip().upper()
    if len(candidate) != 2 or not candidate.isalpha() or not candidate.isascii():
        raise argparse.ArgumentTypeError(
            "country must be a 2-letter ISO 3166-1 code, e.g. DE"
        )
    return candidate


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Check whether GPT-6 Astra is visible to the current Codex account."
    )
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--codex-bin")
    parser.add_argument("--state-file", default=str(default_state_path()))
    parser.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT_SECONDS)
    parser.add_argument(
        "--force",
        action="store_true",
        help="query again even if a success notification was already sent",
    )
    parser.add_argument(
        "--no-notify",
        action="store_true",
        help="do not send desktop notifications or watcher signals",
    )
    parser.add_argument(
        "--test-notification",
        action="store_true",
        help="send a harmless test notification without querying Codex",
    )
    parser.add_argument(
        "--share-country",
        type=country_argument,
        metavar="CC",
        help="after explicit consent, anonymously share active-monitoring heartbeats "
        "plus successful waiting checks and the access timestamp for this "
        "ISO 3166-1 alpha-2 country",
    )
    parser.add_argument(
        "--watcher-url",
        default=DEFAULT_WATCHER_URL,
        help="endpoint used by --share-country (default: %(default)s)",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.timeout <= 0:
        print_result({"status": "error", "error": "--timeout must be positive"}, error=True)
        return 2
    if args.test_notification:
        try:
            send_desktop_notification(
                "Astra Watch is ready",
                "Desktop notifications are working. Astra is still checked separately.",
                "normal",
            )
        except WatcherError as exc:
            print_result({"status": "notification_test_failed", "error": str(exc)}, error=True)
            return 1
        print_result({"status": "notification_test_sent"})
        return 0
    try:
        return check_once(args)
    except WatcherError as exc:
        print_result({"status": "error", "error": str(exc)}, error=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
