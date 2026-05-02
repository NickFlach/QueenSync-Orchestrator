# QueenSync heartbeat sidecars

Runnable, dependency-light heartbeat processes that ship liveness
signals from each external constellation arm into the Queen Console
**without modifying the arm's source code**.

Each sidecar is a single Python file deployed alongside its arm and
managed by `systemd`. The unit files use a four-piece dependency
spec — `After=` + `BindsTo=` + `PartOf=` in `[Unit]` plus
`WantedBy=<arm>.service` in `[Install]` — so the sidecar's process
lifecycle exactly mirrors the arm's:

| Arm event             | Sidecar effect                                  | Mechanism                       |
| --------------------- | ----------------------------------------------- | ------------------------------- |
| arm starts (boot, manual `start`, restart) | sidecar starts after the arm | `WantedBy=<arm>.service` + `After=` |
| arm stops             | sidecar stops immediately                       | `BindsTo=<arm>.service`         |
| arm restarts          | sidecar restarts with it                        | `PartOf=<arm>.service`          |
| arm crashes & is auto-restarted | sidecar follows                       | `BindsTo=` + `PartOf=`          |

End result: arm up → heartbeats flow → Console flips to `idle` within
~30s. Arm down → sidecar exits → 3-min stale sweep
(`heartbeat-scheduler.ts` on the QueenSync side) flips Console to
`offline`. Arm restarted → sidecar comes right back up with it; no
operator intervention required.

> **Swarm Worker is a singleton.** QueenSync's `handlePresence` has no
> per-instance refcount, so any `queen.event.leave` with
> `armId=swarm-worker` immediately demotes the card. Run exactly one
> `queensync-presence-swarm-worker.service` per `swarm-worker` arm row,
> bound to the swarm-worker service unit (which itself can spawn many
> worker processes). For per-worker liveness, register additional arm
> rows and run one sidecar per row.

## Files

| File                              | Purpose                                              | Used by                          |
| --------------------------------- | ---------------------------------------------------- | -------------------------------- |
| `queensync_heartbeat.py`          | HTTP poster → `POST /api/arms/<id>/heartbeat`        | Radio, Observatory, Oracle Admin |
| `queensync_presence.py`           | NATS publisher → `queen.event.join` / `…leave`       | Kannaka Prime, Swarm Worker      |
| `systemd/queensync-heartbeat-radio.service`             | systemd unit — Radio sidecar           | Radio host                |
| `systemd/queensync-heartbeat-observatory.service`       | systemd unit — Observatory sidecar     | Observatory host          |
| `systemd/queensync-presence-kannaka-prime.service`      | systemd unit — Kannaka Prime sidecar   | Kannaka Prime host        |
| `systemd/queensync-presence-swarm-worker.service`       | systemd unit — Swarm Worker sidecar    | Swarm Worker host         |

`queensync_heartbeat.py` is stdlib-only (Python ≥ 3.11). `queensync_presence.py`
needs `pip install nats-py`.

## Why a sidecar instead of editing each arm

The five real arms live in separate repos that aren't part of this
monorepo. Asking each repo to add a heartbeat call works but spreads
the implementation across four codebases and four release cadences.
A standalone sidecar (a) ships from this repo, so it stays in lockstep
with QueenSync's heartbeat scheduler / NATS bridge contract, and
(b) makes adoption a single systemd-unit drop-in instead of a code
change. If a service repo prefers to embed the heartbeat call directly,
both Python files are short enough to vendor verbatim — see
`docs/heartbeat-integration.md` for the embed snippets.

## Quick deploy — one arm

On the host that runs the arm (e.g. the Radio box):

```bash
# 1. Install the sidecar code (one-time, shared across all sidecars on this host).
sudo install -d /opt/queensync-heartbeat
sudo install -m 0755 queensync_heartbeat.py /opt/queensync-heartbeat/
sudo install -m 0755 queensync_presence.py  /opt/queensync-heartbeat/   # only on NATS hosts

# 2. Create the env file (root-owned, mode 0640 so only root + opc can read the token).
sudo tee /etc/queensync-heartbeat-radio.env >/dev/null <<'EOF'
QUEENSYNC_BASE_URL=https://queensync.example.com
QUEENSYNC_OPERATOR_TOKEN=replace-me-with-real-operator-token
QUEENSYNC_ARM_ID=radio
QUEENSYNC_HEARTBEAT_SECONDS=30
EOF
sudo chown root:opc /etc/queensync-heartbeat-radio.env
sudo chmod 0640 /etc/queensync-heartbeat-radio.env

# 3. Install the systemd unit.
sudo install -m 0644 systemd/queensync-heartbeat-radio.service \
    /etc/systemd/system/queensync-heartbeat-radio.service
sudo systemctl daemon-reload
# `enable` here installs a symlink under /etc/systemd/system/radio.service.wants/
# (NOT under multi-user.target.wants/) because the unit declares
# WantedBy=radio.service. That's what makes systemd start the sidecar
# automatically every time radio.service starts — boot, after a manual
# `systemctl restart radio`, after a crash-and-restart, all of it.
sudo systemctl enable --now queensync-heartbeat-radio.service

# Sanity check the symlink landed in the arm's .wants/ dir, not multi-user.target.
ls -l /etc/systemd/system/radio.service.wants/queensync-heartbeat-radio.service
# → lrwxrwxrwx … queensync-heartbeat-radio.service -> /etc/systemd/system/queensync-heartbeat-radio.service

# 4. Verify lifecycle.
sudo journalctl -fu queensync-heartbeat-radio.service
# → "queensync heartbeat sidecar starting (arm=radio …)"
# Within ~30s the Queen Console should show the Radio card as `idle`.

# Restart the arm and confirm the sidecar follows:
sudo systemctl restart radio.service
sudo systemctl is-active queensync-heartbeat-radio.service   # → active
# Stop the arm and confirm the sidecar exits via BindsTo:
sudo systemctl stop radio.service
sudo systemctl is-active queensync-heartbeat-radio.service   # → inactive
# Start the arm again and confirm the sidecar comes back via WantedBy=radio.service:
sudo systemctl start radio.service
sudo systemctl is-active queensync-heartbeat-radio.service   # → active
```

For Observatory: same recipe with `radio` → `observatory` everywhere.

For Kannaka Prime / Swarm Worker (NATS presence — also requires
`pip install nats-py` on the host):

```bash
# Install nats-py (system-wide, or in a venv pinned in the unit file).
sudo pip install nats-py

sudo tee /etc/queensync-presence-kannaka-prime.env >/dev/null <<'EOF'
NATS_URL=nats://nats.example.com:4222
QUEENSYNC_ARM_ID=kannaka-prime
QUEENSYNC_HEARTBEAT_SECONDS=30
EOF
sudo chown root:opc /etc/queensync-presence-kannaka-prime.env
sudo chmod 0640 /etc/queensync-presence-kannaka-prime.env

sudo install -m 0644 systemd/queensync-presence-kannaka-prime.service \
    /etc/systemd/system/queensync-presence-kannaka-prime.service
sudo systemctl daemon-reload
# Symlink lands under /etc/systemd/system/kannaka-prime.service.wants/ so
# the sidecar comes up with every kannaka-prime start (boot/restart/crash).
sudo systemctl enable --now queensync-presence-kannaka-prime.service
ls -l /etc/systemd/system/kannaka-prime.service.wants/queensync-presence-kannaka-prime.service
```

## Local smoke test (without systemd)

```bash
# HTTP heartbeat against a local QueenSync API server:
QUEENSYNC_BASE_URL=http://localhost:5000 \
QUEENSYNC_OPERATOR_TOKEN=$QUEENSYNC_OPERATOR_TOKEN \
QUEENSYNC_ARM_ID=radio \
QUEENSYNC_HEARTBEAT_SECONDS=5 \
LOG_LEVEL=DEBUG \
python3 queensync_heartbeat.py

# NATS presence against a local nats-server:
NATS_URL=nats://127.0.0.1:4222 \
QUEENSYNC_ARM_ID=kannaka-prime \
QUEENSYNC_HEARTBEAT_SECONDS=5 \
LOG_LEVEL=DEBUG \
python3 queensync_presence.py
```

In both cases the corresponding arm card in the Queen Console should
flip to `idle` within seconds. Hit `Ctrl-C` to stop — the presence
script publishes one final `queen.event.leave` so the card flips to
`offline` immediately; the HTTP script exits silently and the card
stays `idle` until the 3-minute stale sweep demotes it.

## Failure semantics

- HTTP sidecar: a non-2xx response or transport error logs a single
  WARN and the next interval retries. The sidecar process never
  exits on a bad response — only on SIGTERM/SIGINT (or unrecoverable
  Python errors).
- NATS sidecar: connection errors at startup propagate (systemd will
  `Restart=on-failure` after 5s). After the initial connect, publish
  errors are warned and retried at the next interval. SIGTERM/SIGINT
  publishes one `queen.event.leave` then closes cleanly.

In both cases, if the sidecar crashes for real, systemd restarts it.
If the *arm* stops, `BindsTo` stops the sidecar and QueenSync's stale
sweep handles demotion.

## Verifying from the QueenSync host

```bash
# Manually fire one heartbeat as the sidecar would. You should see the
# arm card flip to `idle` in the Queen Console within ~1s (over the
# WebSocket).
curl -sS -X POST \
  -H "Authorization: Bearer $QUEENSYNC_OPERATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"source":"manual-test"}' \
  $QUEENSYNC_BASE_URL/api/arms/radio/heartbeat | jq .status
# → "idle"
```
