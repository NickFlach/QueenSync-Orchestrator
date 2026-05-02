#!/usr/bin/env python3
"""
Self-tests for the QueenSync heartbeat sidecars. Run with:

    python3 scripts/heartbeats/test_heartbeat.py

Exits 0 on success, 1 on failure. Stdlib-only (no pytest, no nats-py
dependency — the presence script's NATS path is exercised only at the
helper level).
"""
from __future__ import annotations

import importlib.util
import json
import os
import pathlib
import sys
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent


def _load(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, str(HERE / filename))
    assert spec and spec.loader, f"failed to spec {filename}"
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ─── queensync_heartbeat.py ────────────────────────────────────────────

# Set required env so the module-level _required() doesn't sys.exit
# during any incidental top-level access. (post_heartbeat itself takes
# args, but we want a clean import.)
os.environ.update({
    "QUEENSYNC_BASE_URL": "https://queen.example.com",
    "QUEENSYNC_OPERATOR_TOKEN": "fake-token",
    "QUEENSYNC_ARM_ID": "radio",
})
qh = _load("qh", "queensync_heartbeat.py")


class _FakeResp:
    def __init__(self, status: int) -> None:
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def test_post_heartbeat_ok() -> None:
    calls: list[dict] = []

    def fake_open(req, timeout=None):  # type: ignore[no-untyped-def]
        calls.append({
            "url": req.full_url,
            "method": req.get_method(),
            "auth": req.headers.get("Authorization"),
            "body": req.data,
        })
        return _FakeResp(200)

    urllib.request.urlopen = fake_open  # type: ignore[assignment]
    ok = qh.post_heartbeat(
        "https://q.example.com/", "tok", "radio", timeout=1.0, source="unit-test",
    )
    assert ok is True, f"expected True got {ok!r}"
    assert len(calls) == 1, f"expected 1 call got {len(calls)}"
    c = calls[0]
    assert c["url"] == "https://q.example.com/api/arms/radio/heartbeat", c["url"]
    assert c["method"] == "POST", c["method"]
    assert c["auth"] == "Bearer tok", c["auth"]
    body = json.loads(c["body"])
    assert body == {"source": "unit-test"}, body


def test_post_heartbeat_non_2xx_returns_false() -> None:
    urllib.request.urlopen = lambda req, timeout=None: _FakeResp(503)  # type: ignore[assignment]
    assert qh.post_heartbeat("https://q.example.com", "tok", "radio") is False


def test_post_heartbeat_url_encodes_arm_id() -> None:
    calls: list[dict] = []

    def fake_open(req, timeout=None):  # type: ignore[no-untyped-def]
        calls.append({"url": req.full_url})
        return _FakeResp(200)

    urllib.request.urlopen = fake_open  # type: ignore[assignment]
    qh.post_heartbeat("https://q.example.com", "tok", "swarm/worker 01")
    assert len(calls) == 1
    # Spaces and slashes in the arm id must be percent-encoded so the
    # resulting URL is well-formed and routes to /api/arms/<encoded>/heartbeat.
    assert calls[0]["url"] == (
        "https://q.example.com/api/arms/swarm%2Fworker%2001/heartbeat"
    ), calls[0]["url"]


def test_post_heartbeat_swallows_exceptions() -> None:
    def boom(req, timeout=None):  # type: ignore[no-untyped-def]
        raise ConnectionError("refused")

    urllib.request.urlopen = boom  # type: ignore[assignment]
    assert qh.post_heartbeat("https://q.example.com", "tok", "radio") is False


def test_env_helpers_strip_and_default() -> None:
    os.environ.pop("__HB_TEST__", None)
    assert qh._env("__HB_TEST__") is None
    assert qh._env("__HB_TEST__", "fb") == "fb"
    os.environ["__HB_TEST__"] = "   "
    assert qh._env("__HB_TEST__", "fb") == "fb"
    os.environ["__HB_TEST__"] = "  hello  "
    assert qh._env("__HB_TEST__") == "hello"
    del os.environ["__HB_TEST__"]


# ─── queensync_presence.py ─────────────────────────────────────────────

# Required env so the module loads cleanly.
os.environ.update({
    "NATS_URL": "nats://example:4222",
    "QUEENSYNC_ARM_ID": "kannaka-prime",
})
qp = _load("qp", "queensync_presence.py")


def test_presence_subjects_match_bridge_contract() -> None:
    # Must match `artifacts/api-server/src/lib/nats-bridge.ts → handlePresence`
    # via SUBJECTS.QUEEN_JOIN / SUBJECTS.QUEEN_LEAVE in `lib/nats/src/index.ts`.
    assert qp.JOIN_SUBJECT == "queen.event.join", qp.JOIN_SUBJECT
    assert qp.LEAVE_SUBJECT == "queen.event.leave", qp.LEAVE_SUBJECT


def test_presence_env_helpers_strip_and_default() -> None:
    os.environ.pop("__P_TEST__", None)
    assert qp._env("__P_TEST__") is None
    assert qp._env("__P_TEST__", "fb") == "fb"
    os.environ["__P_TEST__"] = "  "
    assert qp._env("__P_TEST__", "fb") == "fb"
    os.environ["__P_TEST__"] = "  k  "
    assert qp._env("__P_TEST__") == "k"
    del os.environ["__P_TEST__"]


# ─── runner ────────────────────────────────────────────────────────────

TESTS = [
    test_post_heartbeat_ok,
    test_post_heartbeat_url_encodes_arm_id,
    test_post_heartbeat_non_2xx_returns_false,
    test_post_heartbeat_swallows_exceptions,
    test_env_helpers_strip_and_default,
    test_presence_subjects_match_bridge_contract,
    test_presence_env_helpers_strip_and_default,
]


def main() -> int:
    failed = 0
    for t in TESTS:
        try:
            t()
            print(f"  ok  {t.__name__}")
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f"  FAIL  {t.__name__}: {e!r}")
    print(f"\n{len(TESTS) - failed}/{len(TESTS)} passed")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
