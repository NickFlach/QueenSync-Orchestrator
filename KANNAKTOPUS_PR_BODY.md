# Wake Kannaktopus on the Kannaka Constellation observatory

This PR adds a tiny constellation presence beacon so a running Kannaktopus
instance shows up as an agent on
[observatory.ninja-portal.com](https://observatory.ninja-portal.com) and the
matching `kannaktopus_arm` card on the QueenSync Queen Console flips from
`offline` → `idle`.

Today Kannaktopus has no NATS publisher — it talks to the local `kannaka`
HRM binary, runs an MCP server on `:8787`, and emits HTTP telemetry hooks,
but nothing of that surfaces on the public swarm bus
(`nats://swarm.ninja-portal.com:4222`) that feeds the observatory's
`swarm.agents` map. So Kannaktopus is effectively invisible in the
constellation it ships with. This PR fixes that with the smallest possible
addition.

## What's added

| Path                                              | Purpose                                                                                          |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `scripts/queensync_presence.py`                   | Long-running daemon. Publishes `queen.event.join` every 30s (configurable). `queen.event.leave` on shutdown. Reconnects with exponential backoff. |
| `scripts/lib/nats-publish.sh`                     | Optional shell helper. If the `nats` CLI is on `PATH`, `orchestrate.sh` can call `nats_publish_phase` at each phase boundary so Kannaktopus *pulses* as it works (probe / grasp / tangle / ink). Silent no-op if the CLI is missing — never blocks orchestrate. |
| `scripts/systemd/kannaktopus-presence.service`    | Drop-in unit file for Linux hosts.                                                               |
| `docs/observatory-presence.md`                    | Architecture diagram, env vars, run + verify instructions.                                       |

No existing files are modified. The new code is opt-in: nothing publishes
unless the user starts `queensync_presence.py` (or sources
`nats-publish.sh` from their own `orchestrate.sh`). Users who don't want
to participate in the constellation see zero behavioural change.

## How it works

QueenSync's NATS bridge
(`artifacts/api-server/src/lib/nats-bridge.ts → handlePresence`) and the
observatory's swarm ingester both subscribe to `queen.event.join` /
`queen.event.leave` on the public bus. Treating each join as a heartbeat
for the named arm, with a 3-minute staleness sweep on the QueenSync side,
means a 30-second beacon interval is comfortably inside the window with
plenty of headroom for transient connectivity blips.

## Configuration

| Env var                        | Default                              |
| ------------------------------ | ------------------------------------ |
| `NATS_URL`                     | `nats://swarm.ninja-portal.com:4222` |
| `KANNAKTOPUS_ARM_ID`           | `kannaktopus-01`                     |
| `KANNAKTOPUS_DISPLAY_NAME`     | `Kannaktopus`                        |
| `KANNAKTOPUS_PRESENCE_SECONDS` | `30`                                 |

Set `KANNAKTOPUS_ARM_ID=kannaka-prime` to take over the existing seeded
QueenSync arm card instead of registering a new one.

## Verification

After ~30s of the daemon running:

```bash
curl -s https://observatory.ninja-portal.com/api/state \
  | jq '.swarm.agents | keys'
# expected: ["kannaka-01", "kannaktopus-01"]
```

## Dependencies

- `pip install nats-py>=2.7` (only required if you actually run the
  beacon — it's not added to the project's install path).
- `nats` CLI is **optional**, only used by the shell helper for phase
  pulses. The helper detects its absence and stays silent.

## Risk

- New files only; no behaviour change for existing installs.
- The beacon is fault-tolerant — connection failures retry with
  exponential backoff and never raise into the caller.
- Public bus has no auth on publish, but the daemon respects the
  ≥ 30s interval the constellation operators specify.
