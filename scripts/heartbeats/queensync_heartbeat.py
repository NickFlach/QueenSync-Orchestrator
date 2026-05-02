#!/usr/bin/env python3
"""
queensync_heartbeat.py — standalone HTTP heartbeat sidecar.

Runnable as-is. POSTs to QueenSync's
`POST /api/arms/<QUEENSYNC_ARM_ID>/heartbeat` endpoint immediately on
start and then every QUEENSYNC_HEARTBEAT_SECONDS (default 30s). On
SIGTERM / SIGINT it exits cleanly without sending a final beat — the
3-minute staleness sweep on the QueenSync side will demote the arm card
to `offline`.

Designed to be deployed alongside an external arm process (e.g. the
Radio service on its own host) via a systemd unit with
`BindsTo=<arm>.service` so the heartbeat sidecar lives and dies with
the arm. See `scripts/heartbeats/systemd/` for ready-to-install unit
templates and the wiring for Radio, Observatory, Kannaka Prime, and
Swarm Worker.

Stdlib-only — no `pip install` required (Python ≥ 3.11).

Required env:
  QUEENSYNC_BASE_URL          e.g. https://queensync.example.com
  QUEENSYNC_OPERATOR_TOKEN    operator bearer token from QueenSync
  QUEENSYNC_ARM_ID            arm row id ("radio", "observatory", …)

Optional env:
  QUEENSYNC_HEARTBEAT_SECONDS  default 30
  QUEENSYNC_HEARTBEAT_TIMEOUT  default 5
  QUEENSYNC_HEARTBEAT_SOURCE   tag included in the POST body
                               (default: "<arm_id>-sidecar")

Exit codes:
  0  clean shutdown via SIGTERM/SIGINT
  2  missing required env (logs the specific missing var)
"""
from __future__ import annotations

import json
import logging
import os
import signal
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

LOG = logging.getLogger("queensync.heartbeat")


def _env(name: str, default: str | None = None) -> str | None:
    v = os.environ.get(name, default)
    if v is None:
        return None
    v = v.strip()
    return v if v else default


def _required(name: str) -> str:
    v = _env(name)
    if not v:
        LOG.error("missing required env var: %s", name)
        sys.exit(2)
    return v


def post_heartbeat(
    base_url: str,
    token: str,
    arm_id: str,
    *,
    timeout: float = 5.0,
    source: str | None = None,
) -> bool:
    """Post one heartbeat. Returns True on 2xx, False otherwise. Never raises."""
    # URL-encode arm_id so non-trivial IDs (uppercase, slashes, unicode,
    # whatever future arms get named) don't silently produce a malformed
    # URL — keeps parity with the TS heartbeat client which uses
    # encodeURIComponent for the same path segment.
    encoded_arm_id = urllib.parse.quote(arm_id, safe="")
    url = f"{base_url.rstrip('/')}/api/arms/{encoded_arm_id}/heartbeat"
    body = json.dumps({"source": source or f"{arm_id}-sidecar"}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # nosec B310
            ok = 200 <= resp.status < 300
            if ok:
                LOG.debug("heartbeat ok arm=%s status=%s", arm_id, resp.status)
            else:
                LOG.warning("heartbeat non-2xx arm=%s status=%s", arm_id, resp.status)
            return ok
    except urllib.error.HTTPError as e:
        LOG.warning("heartbeat HTTPError arm=%s status=%s url=%s", arm_id, e.code, url)
        return False
    except Exception as e:  # noqa: BLE001 — heartbeat must never crash the sidecar
        LOG.warning("heartbeat error arm=%s err=%s url=%s", arm_id, e, url)
        return False


def main() -> int:
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    base_url = _required("QUEENSYNC_BASE_URL")
    token = _required("QUEENSYNC_OPERATOR_TOKEN")
    arm_id = _required("QUEENSYNC_ARM_ID")
    interval = float(_env("QUEENSYNC_HEARTBEAT_SECONDS", "30") or "30")
    timeout = float(_env("QUEENSYNC_HEARTBEAT_TIMEOUT", "5") or "5")
    source = _env("QUEENSYNC_HEARTBEAT_SOURCE")

    if interval <= 0:
        LOG.error("QUEENSYNC_HEARTBEAT_SECONDS must be > 0 (got %r)", interval)
        return 2

    LOG.info(
        "queensync heartbeat sidecar starting (arm=%s base=%s every %.1fs)",
        arm_id, base_url, interval,
    )

    stop = threading.Event()

    def _shutdown(signum, _frame):  # type: ignore[no-untyped-def]
        LOG.info("received signal %s — shutting down", signum)
        stop.set()

    signal.signal(signal.SIGINT, _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    # Immediate kick so the Console flips to `idle` within seconds, not
    # a full interval.
    post_heartbeat(base_url, token, arm_id, timeout=timeout, source=source)

    while not stop.wait(interval):
        post_heartbeat(base_url, token, arm_id, timeout=timeout, source=source)

    LOG.info("queensync heartbeat sidecar stopped (arm=%s)", arm_id)
    return 0


if __name__ == "__main__":
    sys.exit(main())
