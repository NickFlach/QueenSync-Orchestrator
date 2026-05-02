# Heartbeat integration — wiring real arms into the Queen Console

This document is the operator playbook for getting the five real
constellation arms — **Radio**, **Observatory**, **Kannaka Prime**,
**Swarm Worker**, **Oracle Admin** — to flip from `offline` → `idle` /
`active` in the Queen Console.

## How QueenSync decides an arm is online

QueenSync (`artifacts/api-server/src/lib/heartbeat-scheduler.ts`) runs a
60-second loop that does two things:

1. **Active probe.** For every arm whose row has a non-null
   `heartbeatUrl`, it `GET`s that URL with a 5s timeout. A 2xx response
   refreshes `lastHeartbeat = now()` (and promotes the arm from `offline`
   back to `idle`).
2. **Staleness sweep.** Any arm whose `lastHeartbeat` is older than
   `QUEENSYNC_ARM_STALE_MS` (default 180_000 ms = 3 min) and whose status
   isn't already `offline`/`failed` is demoted to `offline`.

In addition, the NATS bridge
(`artifacts/api-server/src/lib/nats-bridge.ts → handlePresence`) treats
every `queen.event.join` message on the constellation bus as a heartbeat
for the arm named in the payload — `lastHeartbeat = now()` and `status =
"idle"`. A `queen.event.leave` immediately demotes the arm to `offline`.

So each arm has two viable paths:

| Path                 | Who initiates    | Required field on the arm row | Stop signal               |
| -------------------- | ---------------- | ----------------------------- | ------------------------- |
| HTTP probe (pull)    | QueenSync        | `heartbeatUrl` set            | URL goes 4xx/5xx for 3min |
| HTTP push            | The arm itself   | none — uses bearer token      | Push stops for 3 min      |
| NATS presence        | The arm itself   | none — looked up by `armId`   | `queen.event.leave` or 3-min stale sweep |

`/api/arms/:armId/heartbeat` requires an operator bearer token —
configure `QUEENSYNC_OPERATOR_TOKEN` on the QueenSync side and ship the
same token to each arm.

## Per-arm wiring

### Radio (`radio.ninja-portal.com`)

The seed (`artifacts/api-server/src/lib/seed.ts`) sets
`heartbeatUrl: ${RADIO_BASE_URL}/health`, so the **only** code change
needed in the radio repo is to make sure `GET /health` returns 2xx while
the service is up. If you already expose a health endpoint, you're done —
QueenSync will pick it up within a minute.

If `/health` is missing or behind auth, drop in this push-based fallback
(Python 3.11+, stdlib only — no extra deps):

```python
# kannaka-radio/services/queensync_heartbeat.py
"""
Periodic heartbeat to QueenSync. Started as a daemon thread from
`main.py` immediately after the radio service finishes its own boot
sequence. Stop signal: process exit (the daemon thread dies with the
parent), and QueenSync's 3-min staleness sweep demotes the arm card.
"""
from __future__ import annotations
import json
import os
import threading
import time
import urllib.request
import urllib.error
import logging

log = logging.getLogger("queensync.heartbeat")

QUEENSYNC_BASE_URL = os.environ.get("QUEENSYNC_BASE_URL", "").rstrip("/")
QUEENSYNC_TOKEN = os.environ.get("QUEENSYNC_OPERATOR_TOKEN", "")
ARM_ID = os.environ.get("QUEENSYNC_ARM_ID", "radio")
INTERVAL_SECONDS = float(os.environ.get("QUEENSYNC_HEARTBEAT_SECONDS", "30"))


def _beat_once() -> bool:
    if not QUEENSYNC_BASE_URL or not QUEENSYNC_TOKEN:
        return False
    url = f"{QUEENSYNC_BASE_URL}/api/arms/{ARM_ID}/heartbeat"
    body = json.dumps({"source": "radio-self-heartbeat"}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {QUEENSYNC_TOKEN}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            return 200 <= resp.status < 300
    except urllib.error.HTTPError as e:
        log.warning("heartbeat HTTP %s for %s", e.code, url)
        return False
    except Exception as e:  # noqa: BLE001 — heartbeat must never crash radio
        log.warning("heartbeat error: %s", e)
        return False


def _loop() -> None:
    while True:
        _beat_once()
        time.sleep(INTERVAL_SECONDS)


def start_heartbeat() -> threading.Thread | None:
    if not QUEENSYNC_BASE_URL or not QUEENSYNC_TOKEN:
        log.info("QueenSync heartbeat disabled (env vars unset)")
        return None
    t = threading.Thread(target=_loop, name="queensync-heartbeat", daemon=True)
    t.start()
    log.info(
        "QueenSync heartbeat started (arm=%s, interval=%.1fs)",
        ARM_ID, INTERVAL_SECONDS,
    )
    return t
```

Wire it in from `main.py` (or wherever the radio service boots):

```python
from services.queensync_heartbeat import start_heartbeat
start_heartbeat()  # returns immediately; the daemon thread runs forever
```

**README block to paste into `kannaka-radio/README.md`:**

> ## QueenSync heartbeat
>
> The radio reports liveness to the Queen Console two ways:
> 1. QueenSync probes `GET /health` every 60s (configured via
>    `RADIO_BASE_URL` on the QueenSync side).
> 2. `services/queensync_heartbeat.py` pushes
>    `POST $QUEENSYNC_BASE_URL/api/arms/radio/heartbeat` every 30s as a
>    fallback when QueenSync can't reach this host. Set
>    `QUEENSYNC_BASE_URL` and `QUEENSYNC_OPERATOR_TOKEN` in the
>    environment to enable it. The poster is started from `main.py` —
>    grep for `start_heartbeat()`.

### Observatory (`observatory.ninja-portal.com`)

Same shape as Radio. The seed sets
`heartbeatUrl: ${OBSERVATORY_BASE_URL}/health`, so make sure
`GET /health` returns 2xx. Reuse the Python snippet above with two
substitutions:

```python
ARM_ID = os.environ.get("QUEENSYNC_ARM_ID", "observatory")
# ...and rename the file to services/queensync_heartbeat.py inside the
# observatory repo.
```

**README block to paste into `kannaka-observatory/README.md`:** identical
to the Radio block, swap "radio" → "observatory".

### Kannaka Prime (`kannaka-prime` / NATS-bus arm)

This arm is registered with `type: "kannaktopus_arm"` and **no
`heartbeatUrl`** — QueenSync deliberately doesn't probe it over HTTP.
Instead, it listens to NATS and treats every `queen.event.join` message
on the constellation bus as a heartbeat for the arm named in the
payload. So Kannaka Prime needs to **publish a join message on a short
interval** (every 30s is fine — the staleness sweep window is 3 min).

```python
# kannaka-prime/queensync_presence.py
"""
Periodic queen.event.join publisher. Acts as the heartbeat signal for
this arm — QueenSync's NATS bridge sets lastHeartbeat = now() and
status = "idle" on every join message. On a clean shutdown we publish
queen.event.leave so the Console flips to `offline` immediately
(without waiting for the 3-min stale sweep).
"""
from __future__ import annotations
import asyncio
import json
import os
import signal
import logging
import nats  # `pip install nats-py`

log = logging.getLogger("queensync.presence")

NATS_URL = os.environ.get("NATS_URL", "nats://127.0.0.1:4222")
ARM_ID = os.environ.get("QUEENSYNC_ARM_ID", "kannaka-prime")
INTERVAL_SECONDS = float(os.environ.get("QUEENSYNC_HEARTBEAT_SECONDS", "30"))

JOIN_SUBJECT = "queen.event.join"
LEAVE_SUBJECT = "queen.event.leave"


async def run_presence() -> None:
    nc = await nats.connect(NATS_URL, name=f"{ARM_ID}-presence")
    payload = json.dumps({"armId": ARM_ID}).encode("utf-8")

    async def beat() -> None:
        while True:
            await nc.publish(JOIN_SUBJECT, payload)
            await asyncio.sleep(INTERVAL_SECONDS)

    task = asyncio.create_task(beat())
    log.info("queensync presence started (arm=%s, every %.1fs)", ARM_ID, INTERVAL_SECONDS)

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)
    await stop.wait()

    task.cancel()
    try:
        await nc.publish(LEAVE_SUBJECT, payload)
        await nc.flush(timeout=2)
    finally:
        await nc.close()
        log.info("queensync presence stopped (arm=%s) — published leave", ARM_ID)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(run_presence())
```

If kannaka-prime already has a long-lived asyncio loop (it does — it's
serving the NATS REQ/REPLY ASK protocol), fold the `beat()` coroutine
into that loop instead of running this as a separate process.

**README block to paste into `kannaka-prime/README.md`:**

> ## QueenSync presence
>
> Kannaka Prime announces itself to the Queen Console by publishing
> `queen.event.join` on the shared NATS bus every 30s with payload
> `{"armId": "kannaka-prime"}`. QueenSync's NATS bridge
> (`artifacts/api-server/src/lib/nats-bridge.ts`) treats each join as a
> heartbeat. On clean shutdown the service publishes
> `queen.event.leave` for the same `armId` so the Console flips to
> `offline` immediately. See `queensync_presence.py` (or the equivalent
> coroutine inside the main NATS loop).

### Swarm Worker (`kannaka-swarm-worker`)

Identical to Kannaka Prime, but with `ARM_ID="swarm-worker"`.

> **Important — singleton publisher.** QueenSync's `nats-bridge.ts →
> handlePresence` has no per-instance refcount: any `queen.event.leave`
> with `armId=swarm-worker` immediately demotes the arm card to
> `offline`. Run exactly **one** presence sidecar per `swarm-worker`
> arm row, tied to the swarm-worker *service unit* (which itself can
> spawn however many worker processes the queue group needs) rather
> than to each individual worker process. The systemd template at
> `scripts/heartbeats/systemd/queensync-presence-swarm-worker.service`
> binds to the singleton `kannaka-swarm-worker.service` for exactly
> this reason. If you need fine-grained per-worker liveness, register
> additional arm rows (e.g. `swarm-worker-01`, `swarm-worker-02`) and
> run one sidecar per row.

### Oracle Admin (`@workspace/oracle-admin`)

Already wired in this monorepo — see `artifacts/oracle-admin/README.md`
("Heartbeat to QueenSync" section). The shim has both a `/healthz`
endpoint that QueenSync probes and an outbound self-heartbeat poster
(`src/heartbeat.ts`) that activates whenever `QUEENSYNC_BASE_URL` and
`QUEENSYNC_OPERATOR_TOKEN` are set in its environment.

## Verifying

After wiring an arm, confirm from the QueenSync host:

```bash
# Manually fire one heartbeat as the arm would.
curl -sS -X POST \
  -H "Authorization: Bearer $QUEENSYNC_OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"source":"manual-test"}' \
  $QUEENSYNC_BASE_URL/api/arms/radio/heartbeat | jq .status
# → "idle"
```

The arm card in the Queen Console should flip to `idle` within a few
seconds (the WebSocket pushes `arms_updated` to all connected clients).
Stop the arm process and watch the card demote to `offline` within
~3 minutes (or sooner if you've lowered `QUEENSYNC_ARM_STALE_MS` for
the demo).
