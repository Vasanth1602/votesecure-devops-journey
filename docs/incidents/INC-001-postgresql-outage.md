# INC-001 — PostgreSQL Container Outage

**Date:** 2026-06-04
**Phase:** Phase 1 — Containerization
**Severity:** High
**Duration:** ~15 minutes (intentional simulation)
**Status:** ✅ Resolved
**Type:** Intentional failure simulation

---

## What I Was Trying to Learn

Before moving to Phase 3 (CI/CD), I wanted to understand how this system actually behaves when a critical dependency disappears — not in theory, but by watching it happen live.

The goal wasn't to "break things." The goal was:

> *If PostgreSQL dies in production at 2AM, what exactly do I see in the logs, what do my users experience, and how do I know it happened at all?*

---

## Summary

PostgreSQL container was intentionally stopped to simulate a complete database outage. The backend, Redis, NGINX, and frontend container all remained running throughout the incident.

The result was **partial availability** — the React app loaded and the UI was accessible, but every API call requiring database access returned `500 Internal Server Error`. The error in backend logs was not "connection refused" but a DNS resolution failure: Docker could not resolve the hostname `postgres` after the container stopped.

Two additional findings surfaced during investigation that were not part of the original simulation plan:

1. The health endpoint `/api/health` was unreachable through NGINX (returned 404) — exposing a **documentation bug and a proxy gap**.
2. The `/api/auth/me` endpoint continued to work because it reads the JWT payload in memory without a database call — teaching me something about **where state actually lives**.

---

## Symptoms

**What broke immediately:**
- `GET /api/elections` → `500 Internal Server Error`
- `GET /api/elections/{id}` → `500 Internal Server Error`
- `POST /api/auth/login` → `500 Internal Server Error`
- `POST /api/auth/register` → `500 Internal Server Error`
- All endpoints that read from or write to PostgreSQL stopped responding

**What kept working:**
- React app shell loaded normally — NGINX served static files independently
- `GET /api/auth/me` → `200 OK` — reads JWT payload, no DB call
- Redis rate limiting was active — attempting login 6+ times still returned rate limit errors
- JWT token blacklist still enforced — logged-out tokens were still rejected

**What surprised me:**
- `GET /api/health` via NGINX returned `404 Not Found` — not because the service was down, but because the health endpoint is at `/health` on FastAPI, while NGINX only proxies `/api/*` paths. This was a documentation error I only discovered because of this simulation.

---

## Investigation

### Step 1 — Trigger and immediate observation

```bash
docker stop voting-system-postgres-1
docker compose ps
```

```
NAME                        STATUS
voting-system-postgres-1    Exited (137)
voting-system-redis-1       Up (healthy)
voting-system-backend-1     Up
voting-system-frontend-1    Up
```

Three containers up, postgres gone. Backend did not crash — it kept running.

---

### Step 2 — What do the logs say?

```bash
docker compose logs backend --tail=30
```

Expected to see: `Connection refused`

Actually saw:
```
psycopg2.OperationalError: could not translate host name "postgres" to address:
    No address associated with hostname
```

This was an important distinction. "Connection refused" means the host was found but rejected the connection. **"No address associated with hostname"** means Docker DNS could not resolve the hostname `postgres` at all.

When a Docker container stops, it is deregistered from the internal DNS. Other containers can no longer look up its name — they don't even get to attempt a TCP connection.

---

### Step 3 — What can I still reach?

```bash
# Health check via NGINX
curl -s http://localhost:5173/api/health
```
```
404 Not Found
```

This was unexpected. The health endpoint exists at `GET /health` in FastAPI. NGINX proxies `/api/*` → `backend:5000/api/*`. So a request to `/api/health` reaches the backend as `/api/health` — which has no route. The actual health endpoint at `backend:5000/health` is not exposed through NGINX because backend port `5000` has no host mapping.

**Finding:** The health endpoint documented in the README (`http://localhost:5173/api/health`) does not work. This is a documentation and proxy gap.

```bash
# Redis still alive?
docker exec voting-system-redis-1 redis-cli ping
```
```
PONG
```

Redis fully operational throughout the outage.

---

### Step 4 — Which endpoints survived?

| Endpoint | Result | Why |
|---|---|---|
| `GET /` (frontend) | ✅ 200 | NGINX serves static files directly — no backend involved |
| `GET /api/auth/me` | ✅ 200 | Reads JWT payload in memory — no DB call |
| `POST /api/auth/login` | ❌ 500 | Requires DB: `SELECT * FROM users WHERE email = ?` |
| `GET /api/elections` | ❌ 500 | Requires DB: full query with JOINs |
| Rate limiting on `/api/auth/login` | ✅ Active | Redis-based — DB not involved |
| JWT blacklist check | ✅ Active | Redis-based — DB not involved |

---

### Step 5 — Recovery

```bash
docker start voting-system-postgres-1
```

Watched backend logs:

```bash
docker compose logs backend -f
```

No restart of the backend was needed. Within seconds of postgres becoming available, the next API request succeeded. The backend opened a fresh database connection on the next request automatically.

**This is because psycopg2 opens a new connection per request** (`db_connect()` is called inside each route handler). There is no persistent connection pool to drain and reinitialize.

---

## Root Cause

When `docker stop voting-system-postgres-1` was executed, Docker removed the container from the internal bridge network DNS. The hostname `postgres` — which the backend uses in `DB_HOST=postgres` — no longer resolved.

Every subsequent request that called `db_connect()` got a DNS resolution failure:
```
psycopg2.OperationalError: could not translate host name "postgres" to address:
    No address associated with hostname
```

The backend stayed running the entire time because it does not maintain a persistent connection. The failure manifests at the moment of the DB call, not at startup.

---

## Resolution

```bash
docker start voting-system-postgres-1
```

PostgreSQL container restarted, rejoined the Docker network, DNS resolved again. No backend restart required. The next request after postgres became healthy succeeded automatically.

**Time to recovery after docker start:** ~5 seconds (postgres healthcheck interval)

---

## Detection Gap

Nothing alerted during this outage. The backend stayed in a `Up` state throughout. `docker compose ps` showed all containers running. A monitoring system polling container status would have seen **green across the board** while users were getting 500 errors on every page.

The documented health check URL (`http://localhost:5173/api/health`) returns 404 — so even a basic uptime monitor pointed at that URL would report the wrong thing.

**What would actually catch this in production:**
- A health check that runs `SELECT 1` against the database and reports `unhealthy` on failure
- An error rate alert: if 5xx responses exceed 10% of traffic over 60 seconds → alert
- A Prometheus metric tracking `db_connection_errors_total` — would spike immediately
- Application-level health endpoint at `/api/health` that tests the DB, not just that the process is alive

This is exactly what Phase 5 (Prometheus + Grafana) will fix.

---

## Prevention

**Short term — fix the health check:**

The current `/health` endpoint returns a static `{"status": "ok"}` regardless of database availability. A real health check would:

```python
@fastapi_app.get("/health")
async def health():
    try:
        conn = db_connect()
        with conn.cursor() as cur:
            cur.execute("SELECT 1")
        conn.close()
        return {"status": "ok", "db": "connected"}
    except Exception as e:
        return JSONResponse({"status": "degraded", "db": "unavailable"}, status_code=503)
```

And NGINX needs a route to expose it:
```nginx
location /health {
    proxy_pass http://backend:5000/health;
}
```

**Longer term — resilience patterns:**
- **Connection pooling (PgBouncer or SQLAlchemy pool):** Avoids opening a new connection per request. Enables connection reuse and gives a single point to handle reconnection logic.
- **Circuit breaker:** After N consecutive DB failures, stop attempting connections and return a fast `503` instead of hanging. Prevents thundering herd on recovery.
- **Retry with backoff:** On transient connection failures, retry 2-3 times before returning an error.

---

## What I Learned

**Docker DNS is not the same as TCP connectivity.** I expected to see "Connection refused" when postgres stopped. Instead I got a DNS failure. The hostname `postgres` doesn't resolve because the container was deregistered from the network — the TCP connection never even got attempted. This is a fundamental Docker networking behavior that doesn't show up in tutorials.

**Frontend availability is independent of backend health.** The React app loaded fine during the entire outage. A user opening the app for the first time would see a fully rendered UI, then watch every action fail with errors. This is worse UX than a complete outage — the user thinks the app is up but nothing works.

**A health check that doesn't check the database is not a health check.** It's a liveness probe — it tells you the process is alive. A readiness probe tells you the process can actually serve requests. These are different things. Kubernetes formalizes this distinction. Docker Compose doesn't — you have to build it yourself.

**The `/api/auth/me` endpoint working during an outage taught me something important.** It proved that some endpoints can be stateless even in a stateful app. If I wanted to be more resilient, I could cache user profiles in Redis so the app degrades gracefully instead of going fully dark.

**Recovery was automatic — but that's not always true.** Because psycopg2 opens a new connection per request, recovery happened on the next request with no intervention. If I were using a connection pool, I would have needed to drain and reinitialize the pool on recovery. This changes the operational playbook significantly.

**Nothing alerted.** I had to manually check logs, run curl commands, and look in the browser. In production, someone would have to report it or I'd have to notice. That is not acceptable. Observability is not optional — it's what makes the difference between a 5-minute incident and a 2-hour outage.

---

## DevOps Takeaways

| # | Takeaway |
|---|---|
| 1 | **Docker DNS fails before TCP.** Stopped container = hostname unresolvable. Not "refused" — "unknown host." |
| 2 | **Static health checks lie.** A `200 OK` from `/health` means the process is alive. It says nothing about the database. |
| 3 | **Frontend independence is double-edged.** Good: frontend still loads. Bad: users see a working UI that fails on every action. |
| 4 | **Observability gaps are invisible until production.** Zero alerts fired during a full DB outage. That needs to be fixed before going to cloud. |
| 5 | **Stateless endpoints survive stateful failures.** `/api/auth/me` worked because it reads a JWT. Design more endpoints to be stateless where possible. |
| 6 | **Recovery strategy depends on how connections are managed.** Per-request connections recover automatically. Connection pools require explicit recovery logic. Know which you're using. |

---

## Additional Finding — Documentation Bug

This simulation revealed that the Quick Start in `README.md` lists:
```
# Health:   http://localhost:5173/api/health
```

This URL returns `404 Not Found` because:
- FastAPI route: `GET /health` (at root path)
- NGINX proxies: `/api/*` → `backend:5000/api/*`
- Result: `/api/health` → `backend:5000/api/health` → no route → 404

**Fix needed:** Either add a NGINX route for `/health`, or change the FastAPI endpoint to `/api/health`, or remove the health URL from the README.

Tracked as a follow-up fix before Phase 3.

