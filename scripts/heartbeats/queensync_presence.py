#!/usr/bin/env python3
"""
queensync_presence.py — standalone NATS presence sidecar.

Runnable as-is. Connects to NATS and publishes `queen.event.join` with
payload `{"armId": "<QUEENSYNC_ARM_ID>"}` immediately on connect, then
every QUEENSYNC_HEARTBEAT_SECONDS (default 30s). On SIGTERM / SIGINT it
publishes one `queen.event.leave` so the Queen Console flips to
`offline` immediately (without waiting for the 3-min stale sweep).

QueenSync's NATS bridge
(`artifacts/api-server/src/lib/nats-bridge.ts → handlePresence`) treats
every join as a heartbeat: it sets `lastHeartbeat = now()` and
`status = "idle"` for the matching arm row. Every leave demotes the
status to `offline`.

Designed to be deployed alongside a NATS-resident arm (Kannaka Prime,
Swarm Worker, or any future kannaktopus arm) via a systemd unit with
`BindsTo=<arm>.service` so the presence sidecar lives and dies with
the arm. See `scripts/heartbeats/systemd/` for unit templates.

Requires the `nats-py` package (`pip install nats-py`).

Required env:
  NATS_URL                    e.g. nats://nats.example.com:4222
  QUEENSYNC_ARM_ID            arm row id ("kannaka-prime", "swarm-worker", …)

Optional env:
  QUEENSYNC_HEARTBEAT_SECONDS default 30
  QUEENSYNC_NATS_NAME         connection name shown to the broker
                              (default: "<arm_id>-presence")

Exit codes:
  0  clean shutdown via SIGTERM/SIGINT (leave published)
  2  missing required env / nats-py not installed
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import signal
import sys

LOG = logging.getLogger("queensync.presence")

JOIN_SUBJECT = "queen.event.join"
LEAVE_SUBJECT = "queen.event.leave"


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


async def run(
    nats_url: str,
    arm_id: str,
    interval_seconds: float,
    connection_name: str,
) -> int:
    try:
        import nats  # type: ignore[import-not-found]
    except ImportError:
        LOG.error("nats-py is not installed — `pip install nats-py`")
        return 2

    payload = json.dumps({"armId": arm_id}).encode("utf-8")

    LOG.info(
        "queensync presence sidecar connecting (arm=%s url=%s every %.1fs)",
        arm_id, nats_url, interval_seconds,
    )

    nc = await nats.connect(nats_url, name=connection_name)
    LOG.info("connected — publishing initial join (arm=%s)", arm_id)
    await nc.publish(JOIN_SUBJECT, payload)
    await nc.flush(timeout=2)

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)

    async def beat() -> None:
        while not stop.is_set():
            try:
                await asyncio.wait_for(stop.wait(), timeout=interval_seconds)
            except asyncio.TimeoutError:
                try:
                    await nc.publish(JOIN_SUBJECT, payload)
                    LOG.debug("published join arm=%s", arm_id)
                except Exception as e:  # noqa: BLE001
                    LOG.warning("publish join failed arm=%s err=%s", arm_id, e)

    beat_task = asyncio.create_task(beat())
    await stop.wait()
    beat_task.cancel()
    try:
        await beat_task
    except asyncio.CancelledError:
        pass

    try:
        await nc.publish(LEAVE_SUBJECT, payload)
        await nc.flush(timeout=2)
        LOG.info("published leave arm=%s", arm_id)
    except Exception as e:  # noqa: BLE001
        LOG.warning("publish leave failed arm=%s err=%s — relying on stale sweep", arm_id, e)
    finally:
        await nc.close()

    LOG.info("queensync presence sidecar stopped (arm=%s)", arm_id)
    return 0


def main() -> int:
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    nats_url = _required("NATS_URL")
    arm_id = _required("QUEENSYNC_ARM_ID")
    interval = float(_env("QUEENSYNC_HEARTBEAT_SECONDS", "30") or "30")
    if interval <= 0:
        LOG.error("QUEENSYNC_HEARTBEAT_SECONDS must be > 0 (got %r)", interval)
        return 2
    connection_name = _env("QUEENSYNC_NATS_NAME") or f"{arm_id}-presence"
    return asyncio.run(run(nats_url, arm_id, interval, connection_name))


if __name__ == "__main__":
    sys.exit(main())
