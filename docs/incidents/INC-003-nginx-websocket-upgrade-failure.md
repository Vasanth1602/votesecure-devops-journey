# INC-003 — NGINX WebSocket Upgrade Failure

**Date:** 2026-06-10
**Phase:** Phase 2 — Reverse Proxy (NGINX)
**Severity:** High
**Duration:** ~15 minutes (intentional simulation)
**Status:** ✅ Resolved
**Type:** Intentional failure simulation

---

## What I Was Trying to Learn

INC-001 and INC-002 both produced complete failures — the application stopped working. The third class of failure I wanted to understand is more dangerous:

> *What happens when the system appears healthy but a feature silently stops working?*

This is the hardest category of production failure to detect. Dashboards stay green. Alerts don't fire. Logs look normal. But users are experiencing degraded functionality — and no one knows until someone complains.

The specific question: **what happens to the Live Results page if NGINX can't complete the WebSocket upgrade handshake?**

---

## What Socket.IO Is and Why It Matters

Before understanding what broke, it's worth understanding what was being broken.

The admin **Live Results page** is the only screen in VoteSecure that uses real-time communication. When an admin opens this page:

```
1. Frontend (LiveResults.jsx) calls io()
2. Socket.IO client connects to ws://localhost:5173/socket.io/
3. NGINX proxies /socket.io/* → backend:5000/socket.io/
4. Backend (socketio.AsyncServer) accepts the connection
5. Admin emits joinElection → backend adds the client to "election:{id}" room
6. When a voter casts a vote, backend emits resultsUpdated to that room
7. Charts update in the browser without a page refresh
```

This works because of the HTTP → WebSocket upgrade protocol. Without it, real-time event delivery breaks.

---

## Background: How WebSocket Upgrade Works

A WebSocket connection does not begin as a WebSocket. It begins as a plain HTTP/1.1 GET request with special headers signaling the protocol switch:

```
GET /socket.io/?EIO=4&transport=websocket HTTP/1.1
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: <base64 key>
```

The server responds with:
```
HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
```

After the `101 Switching Protocols` response, the HTTP connection is converted into a persistent, bidirectional WebSocket channel. Neither side uses HTTP again for that connection.

**Why NGINX doesn't do this automatically:** By default, NGINX strips hop-by-hop headers — including `Upgrade` and `Connection` — before forwarding a request upstream. The browser sends the upgrade request with those headers, but NGINX removes them before the backend ever sees them. The backend receives a plain HTTP request with no upgrade signal and either ignores or rejects it.

The two lines that fix this:

```nginx
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
```

`$http_upgrade` is an NGINX variable that contains the value of the incoming `Upgrade` header. By explicitly forwarding it, NGINX tells the backend what the browser intended. `proxy_http_version 1.1` is also required — WebSocket is not supported over HTTP/1.0.

---

## How Socket.IO Transport Negotiation Works

Socket.IO doesn't immediately open a WebSocket. It negotiates the best available transport:

```
Phase 1: HTTP long-polling
  GET /socket.io/?EIO=4&transport=polling
  ← 200 OK (establishes session, exchanges capabilities)

Phase 2: Upgrade attempt
  GET /socket.io/?EIO=4&transport=websocket
  Upgrade: websocket
  ← 101 Switching Protocols (if successful)
  → WebSocket connection now active

Phase 3 (if upgrade fails): Stay on polling
  Repeated GET /socket.io/?EIO=4&transport=polling
  ← 200 OK (events delivered via polling intervals)
```

This fallback behavior is Socket.IO's resilience feature. It also makes failure invisible — the connection "works" but at a lower protocol tier.

---

## What Was Intentionally Broken

Two lines removed from `frontend/nginx.conf` inside the `location /socket.io/` block:

```nginx
# Before
location /socket.io/ {
  proxy_pass http://backend:5000/socket.io/;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;   ← removed
  proxy_set_header Connection "upgrade";    ← removed
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

Frontend container rebuilt to apply the change:

```bash
docker compose up -d --build frontend
```

No other files modified. No other containers touched.

---

## Baseline Behavior Before Failure

Before removing the headers, the Live Results page worked as designed.

**Browser DevTools — Network tab (before):**

```
GET /socket.io/?EIO=4&transport=polling    → 200 OK   (handshake)
GET /socket.io/?EIO=4&transport=websocket  → 101 Switching Protocols
```

After the `101`, no more polling requests. A single persistent WebSocket connection handled all events.

**Functional behavior:**
```
Vote Count: 1
Voter casts another vote
Vote Count: 2   ← updated instantly, no refresh
```

---

## Symptoms After the Failure

### Browser Console

```
WebSocket connection to 'ws://localhost:5173/socket.io/?EIO=4&transport=websocket' failed
GET /socket.io/?EIO=4&transport=polling  net::ERR_EMPTY_RESPONSE
```

The WebSocket upgrade attempt failed. NGINX forwarded the request without the `Upgrade` header — the backend did not see a valid upgrade request and did not switch protocols.

### Browser DevTools — Network Tab

```
GET /socket.io/?EIO=4&transport=polling  → repeated, 200 OK
GET /socket.io/?EIO=4&transport=websocket → failed (no 101)
```

Socket.IO fell back to polling. But the polling connection was unreliable — `ERR_EMPTY_RESPONSE` appeared on polling requests, indicating the connection state was degraded. The backend's Socket.IO server couldn't maintain a clean session without the upgrade path.

### Functional User Impact

```
Vote Count: 1
Voter casts another vote
Vote Count: 1   ← unchanged, no real-time event received
Manual page refresh
Vote Count: 2   ← correct data in DB, just not delivered
```

The vote was persisted correctly. The database was correct. The backend emitted `resultsUpdated` into the election room. But the client's Socket.IO session was broken — the event was never received in the browser.

---

## Container States During the Incident

```
voting-system-postgres-1   ✅ Up (healthy)
voting-system-redis-1      ✅ Up (healthy)
voting-system-backend-1    ✅ Up (running)
voting-system-frontend-1   ✅ Up (running)
```

All containers healthy. No process crashed. No error rate spikes in the backend logs. A standard uptime check would have reported the entire system as operational.

---

## What Kept Working

| Component | Status | Why |
|---|---|---|
| React app shell | ✅ | NGINX serves static files — unrelated to WebSocket |
| Login, register | ✅ | REST API over HTTP — no WebSocket involved |
| Voting | ✅ | `POST /api/votes` is HTTP — vote saved correctly |
| Elections list | ✅ | `GET /api/elections` is HTTP |
| PostgreSQL | ✅ | Infrastructure untouched |
| Redis | ✅ | Infrastructure untouched |
| JWT authentication | ✅ | Redis-backed — no WebSocket dependency |

**The entire REST API surface continued to function.** Only the real-time event delivery channel was broken.

---

## Investigation

### Step 1 — Observe the transport negotiation

Open Live Results page in browser. In DevTools → Network → filter by "socket.io":

```
Before fix: 101 Switching Protocols appears — WebSocket active
After break: No 101 — only polling requests, some returning ERR_EMPTY_RESPONSE
```

The absence of `101 Switching Protocols` is the diagnostic signal.

---

### Step 2 — Read the NGINX access log

```bash
docker compose logs frontend --tail=30
```

With headers working (baseline):
```
GET /socket.io/?EIO=4&transport=polling HTTP/1.1" 200
GET /socket.io/?EIO=4&transport=websocket HTTP/1.1" 101
```

With headers removed:
```
GET /socket.io/?EIO=4&transport=polling HTTP/1.1" 200
GET /socket.io/?EIO=4&transport=websocket HTTP/1.1" 400
```

The `400` on the WebSocket request is the backend's response when it receives an upgrade request without the `Upgrade` header — it can't complete the protocol switch.

---

### Step 3 — Verify backend is still processing votes

```bash
docker compose logs backend --tail=20
```

Backend logs show `POST /api/votes 201 Created` — votes are being saved. The `emit_results_update()` call runs after each vote. But the Socket.IO session doesn't have active clients in the election room because the connection was never properly established.

---

### Step 4 — Verify the root cause

Inspect `frontend/nginx.conf` — confirm the `Upgrade` and `Connection` headers are absent from the `/socket.io/` block. All other proxy headers present.

---

## Root Cause

NGINX, by default, strips hop-by-hop headers before forwarding requests to upstream servers. `Upgrade` and `Connection` are hop-by-hop headers.

When a browser sends:
```
GET /socket.io/?EIO=4&transport=websocket HTTP/1.1
Upgrade: websocket
Connection: Upgrade
```

NGINX forwards to backend without the `Upgrade` and `Connection` headers:
```
GET /socket.io/?EIO=4&transport=websocket HTTP/1.1
Host: backend:5000
```

The backend's Socket.IO server receives this as a plain HTTP request. No protocol switch occurs. The backend responds with an error or an HTTP response. No `101 Switching Protocols` is returned. The WebSocket connection is never established.

Socket.IO falls back to polling. But without a clean WebSocket session, the polling transport couldn't maintain a stable enough connection to reliably deliver server-to-client events. The `resultsUpdated` events fired correctly on the backend — but no client was subscribed to receive them.

---

## Why This Is Harder to Detect Than INC-001 or INC-002

| | Detection Difficulty |
|---|---|
| INC-001 — PostgreSQL Outage | Low — all API calls return 500. Error is immediate and obvious. |
| INC-002 — Docker DNS Failure | Low — backend exits. NGINX returns 502. Error is immediate and obvious. |
| INC-003 — WebSocket Upgrade Failure | **High** — all containers healthy. All APIs work. No 5xx errors. Feature silently broken. |

This incident produced no visible error in:
- `docker compose ps`
- Backend application logs
- HTTP error rates
- Container health checks

The only signals were:
1. Browser console (visible only to someone with DevTools open)
2. Live Results page showing stale vote counts
3. Absence of `101 Switching Protocols` in the Network tab

Without someone actively using the Live Results page, this incident could go undetected indefinitely.

---

## Comparison: Three Failure Modes Across Three Incidents

| | INC-001 | INC-002 | INC-003 |
|---|---|---|---|
| **Failure type** | Infrastructure | Configuration | Protocol/Proxy |
| **Layer** | Container / Network | Environment / DNS | HTTP / NGINX |
| **What failed** | PostgreSQL container stopped | DB_HOST pointed to wrong host | WebSocket Upgrade headers stripped |
| **Failure mode** | Per-request 500 | Startup failure → 502 | Silent degradation |
| **Backend state** | Running, returning 500s | Exited | Running, healthy |
| **Infrastructure state** | Postgres down | All healthy | All healthy |
| **Visible symptoms** | Every API call fails | Every request 502 | Only Live Results broken |
| **Detection difficulty** | Easy — immediate 500s | Easy — immediate 502 | Hard — no error codes |
| **Discovery method** | Browser errors / logs | Browser errors / logs | Manual feature testing |
| **Recovery** | `docker start postgres` | Fix env var, recreate | Fix nginx.conf, rebuild |

Each incident broke the system at a different layer. INC-003 is the most production-realistic because it produces no error codes — only degraded user experience.

---

## Detection Gap

This is the most significant detection gap of the three incidents.

No monitoring in its current state would catch this:

- **Container health checks** — all pass
- **Uptime monitoring** — `HTTP 200` everywhere
- **API health checks** — `/health`, `/api/elections` all succeed
- **Error rate alerts** — no 4xx or 5xx from WebSocket path
- **Log-based alerting** — backend logs show no errors

**The gap:** Availability monitoring ≠ functionality monitoring. A service can be available — responding to requests — while an important feature is completely non-functional.

**What would catch this in production:**

| Tool | Signal |
|---|---|
| **Browser error monitoring (Sentry)** | Would capture `WebSocket connection failed` from every user's browser |
| **Frontend telemetry** | Track WebSocket transport type — alert if `transport=polling` persists beyond initial negotiation |
| **Synthetic user monitoring** | Automated browser session that opens Live Results, casts a vote, and verifies the chart updates without refresh |
| **Real-time event delivery metrics** | Track `resultsUpdated` events emitted vs received — gap means events are lost |
| **Socket.IO server metrics** | `connected_clients`, `rooms_active`, `transport_type` — if `ws` never appears, something is wrong |
| **NGINX log parsing** | Alert if `101 Switching Protocols` responses disappear from `/socket.io/` logs |

The lesson: **feature monitoring requires knowing what your features do and testing them end-to-end**, not just checking that your containers respond to pings.

---

## Prevention

**Short term — NGINX config review in CI:**

WebSocket proxy configuration is easy to accidentally break during `nginx.conf` edits. A linting step that validates the presence of `Upgrade` and `Connection` headers in the `/socket.io/` block would catch this before deployment.

**Medium term — Smoke test after deployment:**

A post-deploy verification script that:
1. Opens a Socket.IO connection to the application
2. Verifies transport upgrades to `websocket` (not stuck on `polling`)
3. Emits `joinElection` and verifies room acknowledgment
4. Fails the deploy if WebSocket doesn't upgrade within 5 seconds

**Longer term — Observability:**

- Sentry (or equivalent) for browser-side WebSocket error tracking
- Prometheus metrics on Socket.IO connection types and event delivery rates
- Synthetic monitoring that tests real-time flows, not just HTTP endpoints

---

## What I Learned

**Availability is not the same as functionality.** Every health check passed. Every API worked. The system was "up" by every standard infrastructure metric — and a feature was broken. This is the gap between infrastructure observability and application observability.

**WebSocket is a different protocol that requires explicit proxy support.** NGINX doesn't treat WebSocket as an extension of HTTP. It strips the upgrade headers by default because those are hop-by-hop headers — meant for the immediate connection, not the upstream. You have to explicitly opt in by forwarding `Upgrade` and `Connection`. This is not a configuration quirk — it's how the HTTP spec defines those headers.

**Socket.IO's fallback is also its failure mode.** The transport fallback to long-polling is designed as resilience — but it also hides failures. The browser doesn't show a hard error. The application appears to work. Users see stale data. This is worse than a visible error in some ways — at least a visible error signals that something is wrong.

**Silent degradation is harder to diagnose than outages.** INC-001 and INC-002 were immediately obvious. INC-003 required opening DevTools, watching the Network tab, and understanding what `101 Switching Protocols` is supposed to look like. Most engineers don't have that mental model until they've seen it break.

**Protocol knowledge matters in operations.** Understanding the HTTP Upgrade handshake, hop-by-hop headers, and Socket.IO transport negotiation is what allowed this incident to be diagnosed in minutes rather than hours. Without that knowledge, the absence of an error code makes this nearly impossible to debug.

**Reverse proxies are not transparent.** NGINX modifies requests as it forwards them. Understanding which headers get stripped, which get added, and which need explicit configuration is essential operational knowledge when running applications behind a proxy.

---

## DevOps Takeaways

| # | Takeaway |
|---|---|
| 1 | **Availability ≠ functionality.** Green containers and 200 responses don't mean features work. Test what users actually do. |
| 2 | **WebSocket requires explicit NGINX configuration.** `Upgrade` and `Connection` are hop-by-hop headers — NGINX strips them by default. Always forward them explicitly for WebSocket paths. |
| 3 | **`101 Switching Protocols` is your health signal for WebSocket.** If it never appears in your proxy logs, the upgrade failed. |
| 4 | **Socket.IO's polling fallback hides failures.** The fact that it "works" in polling mode masks the fact that it should be using WebSocket. Know what normal looks like. |
| 5 | **Silent degradation needs feature-level monitoring.** Infrastructure metrics miss this class of failure entirely. You need telemetry at the application and browser layer. |
| 6 | **Protocol-level failures require protocol-level knowledge to diagnose.** This incident was only diagnosable by understanding the HTTP Upgrade handshake. Invest in network protocol fundamentals. |
| 7 | **Rebuild means rebuild.** NGINX configuration lives in the frontend container. Config changes require `docker compose build frontend` — not just a restart. Know which changes require a rebuild vs a restart. |
