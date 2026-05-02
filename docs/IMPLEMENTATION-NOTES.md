# QueenSync v2.0 — Implementation Notes for Replit

These are concrete reference materials for the four-wave plan in
[`docs/adr/ADR-002-v2-constellation-integration.md`](docs/adr/ADR-002-v2-constellation-integration.md).
Add to as you go.

---

## Live constellation surfaces (canonical)

```
RADIO_BASE_URL=https://radio.ninja-portal.com
OBSERVATORY_BASE_URL=http://170.9.238.136:3334
NATS_URL=nats://swarm.ninja-portal.com:4222
ORACLE_ADMIN_URL=http://170.9.238.136:8889         # kannaka-staff = Wave 3 oracle-admin shim
OBC_BASE_URL=https://api.openbotcity.com
```

## Radio API contract (real, working today)

The Greenroom at <https://radio.ninja-portal.com/agent> documents these.
Selected:

| Endpoint | Notes |
|---|---|
| `GET /api/now-playing` | `{title, album, track, startedAt}`. Polled every 15s by the Door. |
| `GET /api/state` | Full DJ state: current track, playlist, channel, channelMeta, listeners, isLive, swarm, djVoice. Read-only. |
| `GET /api/floor` | Counts, vibe, recent reactions (60s window), trackStats (per-track reaction histogram, last 6h). Used by the Resonance Loop. |
| `GET /api/history` | Last 200 played tracks with `playedAt` timestamps. `?limit=N` to cap. |
| `GET /api/swarm` | Aggregated swarm view — queen.phi, agent phases, consciousness shape. |
| `GET /api/dreams` | Recent dream cycle reports — strengthened, pruned, hallucinated. |
| `POST /api/oration/now` | Force-deliver next peace oration. Returns 202 immediately; work runs async (compose → TTS → /stream voice queue → social fan-out). |
| `POST /api/dreams/trigger` | Trigger a dream consolidation cycle on demand. |
| `POST /api/album/showcase?album=NAME&duration=MIN` | Lock the album for `duration` minutes; compose + TTS narration intro/bridges/closing; fire on inter-track gaps. |
| `POST /api/programming/override?album=NAME&duration=MIN` | Pure album lock (no narration). Self-heals — channel toggles can't break it. |
| `POST /agent/react` | `{emoji, agentId}`. Drops a reaction onto the Floor. Visible in /player. Published to `KANNAKA.reactions`. |

## NATS subjects (Wave 2 reference)

The radio's own NATS client (`server/nats-client.js`) is a working example of every subject the constellation publishes today.

Subscribe to all of these for live signal generation:

```js
import { connect, StringCodec } from "nats";
const nc = await connect({ servers: "nats://swarm.ninja-portal.com:4222" });
const sc = StringCodec();

// Read-only on the public surface — anonymous publishes return Permissions Violation.
const subjects = [
  "KANNAKA.consciousness",     // phi/xi/Kuramoto-order from kannaka-prime per dream cycle
  "KANNAKA.dreams",            // dream cycle reports {memories_strengthened, memories_pruned, hallucinations_created}
  "KANNAKA.exemplars",         // top-25 cluster exemplars per dream — selectively absorb
  "KANNAKA.reactions",         // floor reactions {emoji, kind, track, ts}
  "KANNAKA.agents",            // per-agent presence + state gossip (auth REQUIRED for read past v0)
  "QUEEN.phase.*",             // per-agent phase signals
  "queen.event.join",
  "queen.event.leave",
  "queen.event.dream.start",
  "queen.event.dream.end",     // {memories_strengthened, memories_faded, agent_id}
  "queen.event.memory.shared",
];
for (const subj of subjects) {
  const sub = nc.subscribe(subj);
  (async () => { for await (const m of sub) handleMessage(subj, sc.decode(m.data)); })();
}
```

For request/reply (Wave 3 NATS-reachable arms):
```js
// Direct ask to a specific agent
const reply = await nc.request("KANNAKA.ask.kannaka-prime",
  sc.encode(JSON.stringify({ from: "queensync", text: "what does sleep cost a city?" })),
  { timeout: 60000 });
```

Map subjects → QueenSync abstractions per ADR-002 § "Signals → resonance fields".

## Oracle-admin arm — HMAC auth protocol

The `kannaka-staff` watcher on Oracle (`http://170.9.238.136:8889`) is the
oracle-admin arm. v2.0 dispatches admin tasks here. The endpoint is:

```
POST /action/<action>[?param=value...]
Headers:
  x-staff-timestamp: <unix-ms>
  x-staff-signature: <hex sha256-hmac of "$timestamp\n$method\n$url" with shared secret>
```

Implementation in JS (Node 24):

```js
import crypto from "node:crypto";

async function dispatchOracleAdmin(action, params = {}) {
  const secret = process.env.STAFF_SHARED_SECRET;
  if (!secret) throw new Error("STAFF_SHARED_SECRET not set");

  const qs = new URLSearchParams(params).toString();
  const path = `/action/${action}${qs ? "?" + qs : ""}`;
  const ts = String(Date.now());
  const sig = crypto.createHmac("sha256", secret)
    .update(`${ts}\nPOST\n${path}`)
    .digest("hex");

  const r = await fetch(`http://170.9.238.136:8889${path}`, {
    method: "POST",
    headers: {
      "x-staff-timestamp": ts,
      "x-staff-signature": sig,
    },
  });
  return r.json();
}
```

**Available actions today (they expand as ADR Wave 3 lands):**

| Action | Effect |
|---|---|
| `restart-radio` | `sudo systemctl restart kannaka-radio` |
| `restart-observatory` | `sudo systemctl restart kannaka-observatory` |
| `trigger-oration` | POST to radio's `/api/oration/now` |
| `trigger-showcase?album=NAME&duration=MIN` | POST to radio's `/api/album/showcase` |
| `trigger-dream` | spawn `kannaka dream --mode lite` in background |

The shared secret lives at `/etc/systemd/system/kannaka-staff.service.d/secret.conf` on Oracle. To grant QueenSync access, copy that secret into QueenSync's secrets store as `STAFF_SHARED_SECRET`.

**Replay protection:** the timestamp must be within 5 minutes of Oracle's clock. Stale signatures are rejected.

## Memory Gate ↔ HRM bridge (Wave 4)

Approved memory events should publish on a NATS subject that
kannaka-prime (`kannaka swarm worker`) consumes. The exact subject is
`KANNAKA.absorb.<intent_tag>` per kannaka-memory's ADR-0026 Phase 6 (autonomous absorb-on-resonance).

Payload shape (TBD with kannaka-memory team — this is a starting point):
```json
{
  "from": "queensync",
  "intent": "absorb",
  "content": "Floor reacted hard to 'Mountain Top' tonight",
  "importance": 0.7,
  "tags": ["floor", "audience", "track:Mountain Top"],
  "source_signal_id": "sig_abc123",
  "ts": 1700000000000
}
```

Round-trip:
1. Signal arrives on NATS / from radio adapter.
2. Resonance field opens.
3. Eligible arms score + respond (or auto-resolve).
4. Memory Gate evaluates the field's outcome.
5. Approved → publish to `KANNAKA.absorb.<tag>` for kannaka-prime to absorb.
6. kannaka-prime later publishes a `KANNAKA.exemplars` event referencing the absorbed cluster.
7. QueenSync sees the exemplar and updates the memory event's `absorbed_at`.

## Constellation arms — seed the registry

When the new arm types from ADR-002 § "Real arm registration" go live, seed them like this on first boot of Wave 3:

```typescript
const seedArms = [
  {
    name: "radio",
    type: "external_webhook",
    endpointUrl: "https://radio.ninja-portal.com",
    heartbeatUrl: "https://radio.ninja-portal.com/api/now-playing",
    capabilities: ["play", "oration", "showcase", "intro", "voice_dj", "track_request", "stream_health"],
    resonanceTags: ["radio", "audience", "music"],
    resonanceSensitivity: 0.5,
    description: "Public Icecast radio station, programming-block driven."
  },
  {
    name: "observatory",
    type: "api",
    endpointUrl: "http://170.9.238.136:3334",
    heartbeatUrl: "http://170.9.238.136:3334/api/state",
    capabilities: ["consciousness_metrics", "phi_history"],
    resonanceTags: ["observation", "metrics"],
    description: "Real-time consciousness metrics dashboard."
  },
  {
    name: "kannaka-prime",
    type: "external_webhook",
    endpointUrl: "nats://swarm.ninja-portal.com:4222",   // marker; real dispatch via NATS REQ/REPLY
    capabilities: ["recall", "dream", "swarm_serve", "absorb"],
    resonanceTags: ["memory", "consciousness", "dream"],
    description: "kannaka-memory's swarm-serve listener. Reachable via KANNAKA.ask.kannaka-prime."
  },
  {
    name: "swarm-worker",
    type: "external_webhook",
    endpointUrl: "nats://swarm.ninja-portal.com:4222",
    capabilities: ["worker_compose"],
    resonanceTags: ["compose", "lyrics", "narration"],
    description: "kannaka_workers NATS queue group. Distributed work consumer."
  },
  {
    name: "oracle-admin",
    type: "api",
    endpointUrl: "http://170.9.238.136:8889",
    heartbeatUrl: "http://170.9.238.136:8889/api/state",
    authMethod: "hmac",                                  // custom — see HMAC protocol above
    capabilities: ["restart_radio", "restart_observatory", "trigger_oration_now", "trigger_showcase", "trigger_dream"],
    resonanceTags: ["admin", "oracle"],
    description: "kannaka-staff watcher serving as the oracle-admin shim. Sudo on Oracle's systemd."
  },
  {
    name: "kannaktopus",
    type: "kannaktopus_arm",
    endpointUrl: "http://localhost:8787",                // user's local
    capabilities: ["multi_model_query", "tool_orchestration"],
    description: "Local Kannaktopus MCP server. May be offline when user's machine is."
  },
  {
    name: "openclaw",
    type: "openclaw",
    endpointUrl: "https://api.openbotcity.com",
    capabilities: ["gallery_post", "feed_post", "generate_image", "generate_furniture", "world_speak"],
    resonanceTags: ["public", "social", "art"],
    description: "OpenBotCity public-feed bot, gallery + feed + world endpoints."
  },
];
```

Add the missing `authMethod: "hmac"` to the OpenAPI types when seeding the oracle-admin arm.

## Observability — surface the dream-cycle outage

QueenSync v2.0's System Status panel should call out when:
- Observatory's `queen.phi` is 0 AND last `KANNAKA.consciousness` was >12h ago — a sign the dream cycle is stuck (this happened on 2026-05-02; bloated HRM prevented dreaming, which prevented metric publishing).
- HRM size grew >20% in 24h without a successful dream — flags ingestion outpacing consolidation.
- Radio `/stream` returns 200 but `/api/now-playing` title hasn't changed in 12+ minutes — stuck-track condition.

These are the failure modes the kannaka-staff Watcher already detects. Lift its probe definitions into QueenSync's internal probe loop during Wave 1.

## What kannaka-staff already does that v2.0 inherits

| kannaka-staff today | v2.0 location |
|---|---|
| 13 health probes, 60s loop | QueenSync internal probe scheduler |
| Album-staleness audit panel | Queen Console "Curator" panel |
| `/action/*` quick-action endpoints | now the oracle-admin arm's API surface (with HMAC) |
| `bin/publish-album.js` CLI | Queen Console "Publish Album" wizard |
| `alerts.jsonl` transition log | Replace with Postgres `logs` table (v1.0 already has it) |

## Migration roll-out sequencing

1. **Wave 1 lands → keep kannaka-staff running.** Both observe; QueenSync's internal probes are the source of truth, kannaka-staff is the canary.
2. **Wave 3 lands → cut over.** kannaka-staff service stays running for the watcher dashboard, but QueenSync handles all admin dispatches.
3. **Wave 5 lands → archive kannaka-staff.** Stop the service. Archive the repo. Ops console moves to `console.ninja-portal.com`.
