# INC-002 — Docker Service Discovery Failure

**Date:** 2026-06-06
**Phase:** Phase 1 — Containerization
**Severity:** Critical
**Duration:** ~10 minutes (intentional simulation)
**Status:** ✅ Resolved
**Type:** Intentional failure simulation

---

## What I Was Trying to Learn

After INC-001, I understood what happens when a healthy container disappears from the network. But there was a different class of failure I wanted to explore:

> *What happens when the infrastructure is completely healthy, but the configuration is wrong?*

This is a more realistic production failure. Containers don't often crash randomly. But misconfiguration during deployment — a wrong environment variable, a stale `.env` file, a copy-paste error — happens regularly. I wanted to understand exactly what breaks, at what layer, and how it looks different from an infrastructure failure.

The specific question: **what happens if a developer accidentally sets `DB_HOST=localhost` instead of `DB_HOST=postgres`?**

---

## Summary

`DB_HOST` in `backend/.env` was changed from `postgres` to `localhost`. The backend container was force-recreated to pick up the new environment variable. The backend failed to start — not during request processing, but **at application startup**, before accepting any connections.

Unlike INC-001, where the backend stayed running and failed per-request, here the backend process exited entirely. NGINX could no longer reach its upstream. Every request returned `502 Bad Gateway`.

The rest of the infrastructure — PostgreSQL, Redis, NGINX, frontend — remained completely healthy throughout. This was a **configuration-induced total outage with zero infrastructure failure**.

---

## What Changed Before the Outage

```env
# backend/.env — before
DB_HOST=postgres

# backend/.env — after (intentional misconfiguration)
DB_HOST=localhost
```

Backend was force-recreated to apply the change:

```bash
docker compose up -d --force-recreate backend
```

> **Why `--force-recreate`?** Changing `.env` does not automatically restart containers. Docker Compose only picks up new environment variables when a container is recreated, not just restarted. `--force-recreate` destroys and rebuilds the backend container with the new configuration.

---

## Symptoms

**What users experienced:**
- Frontend loaded normally — NGINX served the React app from static files
- Attempting to log in: `502 Bad Gateway`
- Every API request: `502 Bad Gateway`
- The app appeared visually healthy but was completely non-functional

**What the backend showed:**
```
INFO:     Started server process [1]
INFO:     Waiting for application startup.
ERROR:    Application startup failed. Exiting.
```

The backend started, attempted to initialize, failed, and **exited**. No requests were ever accepted.

**What NGINX showed:**
```
[error] connect() failed (113: Host is unreachable) while connecting to upstream,
client: 172.19.0.1, server: localhost,
request: "POST /api/auth/login HTTP/1.1",
upstream: "http://172.19.0.4:5000/api/auth/login"
```

**Container states:**

| Container | Status |
|---|---|
| postgres | ✅ Healthy |
| redis | ✅ Healthy |
| frontend | ✅ Healthy |
| backend | ❌ Exited (startup failure) |

All infrastructure healthy. Application completely down.

---

## Investigation

### Step 1 — Read the exact error

```bash
docker compose logs backend --tail=40
```

```
INFO:     Started server process [1]
INFO:     Waiting for application startup.
ERROR:    Traceback (most recent call last):
  File "/app/main.py", line 1180, in on_startup
    conn = db_connect()
  File "/app/main.py", line 101, in db_connect
    return psycopg2.connect(...)
  File "psycopg2/__init__.py", line 122, in connect
    conn = _connect(dsn, connection_factory=connection_factory, **kwasync)

psycopg2.OperationalError: connection to server at "localhost" (::1), port 5432 failed: Connection refused
    Is the server running on that host and accepting TCP/IP connections?

connection to server at "localhost" (127.0.0.1), port 5432 failed: Connection refused
    Is the server running on that host and accepting TCP/IP connections?

ERROR:    Application startup failed. Exiting.
```

This is immediately different from INC-001.

In INC-001 the error was:
```
could not translate host name "postgres" to address: No address associated with hostname
```

In this incident:
```
connection to server at "localhost" (::1), port 5432 failed: Connection refused
connection to server at "localhost" (127.0.0.1), port 5432 failed: Connection refused
```

**`localhost` resolved.** psycopg2 tried IPv6 (`::1`) first, then IPv4 (`127.0.0.1`). Both resolved successfully. Both refused the TCP connection. The hostname was never the problem — there just wasn't a PostgreSQL process listening on port 5432 inside the backend container's own network.

---

### Step 2 — Why did psycopg2 try two addresses?

`localhost` is resolved via `getaddrinfo()`, the OS DNS resolver. It returns all known addresses for the hostname. Modern Linux systems return both:
- `::1` (IPv6 loopback)
- `127.0.0.1` (IPv4 loopback)

psycopg2 tries each address in sequence. Both fail with `Connection refused` — not because the network is down, but because nothing is listening on port 5432 on those addresses inside the backend container.

---

### Step 3 — Where is `localhost` pointing?

This is the core of the misunderstanding.

Each Docker container has its **own network namespace** — its own isolated loopback interface. When the backend container resolves `localhost`, it maps to `127.0.0.1` *inside the backend container's own loopback*. PostgreSQL runs in a separate container, in a separate network namespace. It is not visible at `127.0.0.1` from inside the backend container.

```
backend container (network namespace A):
  localhost → 127.0.0.1 → nothing listening on :5432 → Connection Refused

postgres container (network namespace B):
  has PostgreSQL listening on :5432
  only reachable via Docker's internal bridge network
  hostname: "postgres"
```

The backend was trying to connect to itself. PostgreSQL was running fine — in a completely different network namespace, reachable only by its service name.

---

### Step 4 — Why did the backend exit instead of staying running?

In INC-001, the backend stayed running and failed per-request. Here the backend exited entirely.

The difference is **where the DB connection is made**.

Looking at `main.py`:

```python
@fastapi_app.on_event("startup")
async def on_startup():
    validate_env()
    conn = db_connect()          # ← DB call at startup, not per-request
    # ... runs schema, seeds admin user
```

The backend calls `db_connect()` at startup to apply the schema and seed the admin user. If this fails, the startup event raises an unhandled exception and Uvicorn exits.

In INC-001, the backend was already past this startup phase when postgres was stopped. Requests failed per-route because `db_connect()` in each route handler failed. The process kept running.

Here, the backend never passed startup. It exited before accepting a single connection.

---

### Step 5 — Why did NGINX return 502 and not 503 or 504?

```
[error] connect() failed (113: Host is unreachable) while connecting to upstream,
upstream: "http://172.19.0.4:5000/api/auth/login"
```

NGINX knew the backend's IP address (`172.19.0.4`) from DNS resolution. But when it attempted a TCP connection to port 5000, the backend container had already exited. Error `113` is `EHOSTUNREACH` — host unreachable.

- `502 Bad Gateway` = NGINX reached the upstream address but received an invalid response, or the upstream rejected/dropped the connection
- `504 Gateway Timeout` = NGINX reached the upstream but it didn't respond in time

Here, the backend was unreachable (container exited) so NGINX returned `502`.

---

### Step 6 — Confirm PostgreSQL was untouched

```bash
docker compose ps
```

```
voting-system-postgres-1   Up (healthy)
voting-system-redis-1      Up (healthy)
voting-system-frontend-1   Up (healthy)
voting-system-backend-1    Exited (1)
```

```bash
docker exec voting-system-postgres-1 pg_isready -U postgres
```

```
/var/run/postgresql:5432 - accepting connections
```

PostgreSQL was fully operational, accepting connections, serving the correct database. The outage had zero infrastructure cause.

---

## Root Cause

A single environment variable with an incorrect value:

```env
DB_HOST=localhost   # wrong — localhost inside the backend container is its own loopback
DB_HOST=postgres    # correct — Docker service name, resolved by Docker's internal DNS
```

When `DB_HOST=localhost`, psycopg2 attempted to connect to the backend container's own loopback interface (`127.0.0.1:5432`). No PostgreSQL process runs inside the backend container. The TCP connection was refused. The backend startup event failed. Uvicorn exited. NGINX had no upstream to proxy to. All API requests returned `502 Bad Gateway`.

**Zero infrastructure components failed.** The outage was caused entirely by a misconfigured environment variable.

---

## Comparison with INC-001

| | INC-001 — Postgres Stopped | INC-002 — Wrong DB_HOST |
|---|---|---|
| **Cause** | Infrastructure failure | Configuration failure |
| **DNS behavior** | DNS failed — "postgres" not resolvable | DNS succeeded — "localhost" resolved to 127.0.0.1 |
| **TCP behavior** | Never attempted | Attempted and refused |
| **Error** | No address associated with hostname | Connection refused |
| **Backend state** | Stayed running | Exited at startup |
| **Failure mode** | Per-request 500 | Startup failure → 502 |
| **Postgres state** | Stopped | Fully healthy |
| **Recovery** | `docker start postgres` | Fix config → recreate container |

The key distinction: in INC-001 the hostname couldn't be resolved. In INC-002 the hostname resolved correctly — to the wrong address. DNS was never the problem. The network was never the problem. The port was the problem.

---

## Resolution

```env
# Restored backend/.env
DB_HOST=postgres
```

```bash
docker compose up -d --force-recreate backend
```

```
✔ Container voting-system-postgres-1   Healthy
✔ Container voting-system-redis-1      Healthy
✔ Container voting-system-backend-1    Started
```

Backend started, completed startup sequence (schema applied, admin seeded), began accepting requests. Application fully restored.

---

## Detection Gap

The detection gap here is worse than INC-001.

In INC-001, the backend was still running — a health check polling the backend process would have shown it as alive even while DB calls failed. At least the backend container was in a running state.

In INC-002, the backend container exited. `docker compose ps` clearly showed `Exited (1)`. But in production, no one is watching `docker compose ps` manually.

**What would catch this:**
- Container restart monitoring — an alert on `container_exit` events would fire immediately
- A `HEALTHCHECK` directive in the backend Dockerfile — Docker would mark the container unhealthy before NGINX tried to proxy to it
- Process supervisor alerting (systemd, supervisord) — exits trigger immediate notification
- Prometheus `up` metric — when the backend stops scraping, the metric disappears and alerts fire

The current state: backend exits silently, NGINX returns 502, nothing alerts. Someone discovers it when they try to log in.

---

## Prevention

**Short term — add HEALTHCHECK to backend Dockerfile:**

```dockerfile
HEALTHCHECK --interval=10s --timeout=5s --retries=3 \
  CMD curl -f http://localhost:5000/health || exit 1
```

With a health check, Docker would mark the backend as `unhealthy` before NGINX routes traffic to it. NGINX could be configured to skip unhealthy upstreams.

**Medium term — environment variable validation at startup:**

The backend already calls `validate_env()` at startup — but it only checks that variables are present, not that they have valid values. A smarter check would attempt the connection during validation and fail fast with a clear error:

```
FATAL: Could not connect to DB_HOST=localhost. 
Did you mean the Docker service name? (e.g. DB_HOST=postgres)
```

**Longer term — infrastructure:**
- Kubernetes liveness and readiness probes enforce this automatically — a container that fails its readiness probe never receives traffic from the Service
- Secret management systems (HashiCorp Vault, AWS Secrets Manager) prevent configuration drift — values are centrally managed, not hand-edited in `.env` files

---

## What I Learned

**`localhost` inside a container means that container's loopback — nothing else.** This is the single most common mistake developers make when containerizing an application for the first time. Every tutorial warns about it. It still took seeing the exact error message in real logs to fully internalize it.

**DNS resolution success is not the same as connectivity.** `localhost` resolved perfectly to `127.0.0.1`. The DNS lookup succeeded. The network lookup succeeded. The failure was at the TCP layer — nothing was listening. Success at one layer tells you nothing about the next layer.

**Startup failures and runtime failures look completely different.** If the DB call happened per-request (as in INC-001), the backend would have stayed up and returned 500s. Because it happens at startup, the backend exited. Two different failure modes, same root cause, completely different symptoms and recovery procedures.

**502 tells you the upstream is unreachable. 500 tells you the upstream is running but erroring.** This distinction matters when you're debugging at speed. A 502 means start with infrastructure — is the backend container running? A 500 means start with application logs — what's the backend doing when it processes the request.

**All infrastructure healthy + application down = configuration error.** When postgres, redis, nginx, and frontend are all green and the app still doesn't work, the problem is almost always configuration. Check environment variables first.

**`--force-recreate` matters.** Changing `.env` and running `docker compose restart` would not have applied the new value. Docker Compose only picks up environment changes on container recreation, not restart. This is a subtle operational behavior that causes confusion when environment changes appear to have no effect.

---

## DevOps Takeaways

| # | Takeaway |
|---|---|
| 1 | **`localhost` = the container itself.** In a multi-container setup, use service names. Always. This is Docker networking 101 — and it still burns people in production. |
| 2 | **DNS success ≠ connectivity.** The hostname resolved. The connection failed. Debug layer by layer. |
| 3 | **Startup failures and runtime failures require different playbooks.** Know which you're dealing with before starting the investigation. |
| 4 | **502 = dead upstream. 500 = broken upstream.** The error code is your first debugging signal, not just noise. |
| 5 | **`--force-recreate` is required for env var changes.** `restart` is not enough. Know your Compose commands. |
| 6 | **Healthy infrastructure with a broken app = configuration drift.** When containers are green but the app is 502, start at the config, not the containers. |
| 7 | **Startup validation should fail loudly.** A `validate_env()` that only checks presence is not enough. Test the actual connection. |

