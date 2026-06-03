# Phase 1 — Containerization

**Goal:** Convert a locally-run multi-service application into a reproducible, portable, containerized system using Docker and Docker Compose.

---

## Why Containerization Was Introduced

Before containerization, running this application required:
- A locally installed PostgreSQL instance configured with the right database and user
- A locally installed Redis instance
- A Python virtual environment with all dependencies
- A Node.js environment to run the React frontend dev server
- Manual coordination of startup order (Redis and PostgreSQL had to be running before the backend)

Any environment difference — Python version, OS, PostgreSQL version, port conflict — could break the stack. There was no isolation between services, no reproducibility guarantee, and no clean way to reset to a known state.

Docker Compose solves all of this. Every service runs in its own isolated container with pinned image versions, and the entire stack starts with a single command.

---

## Container Architecture

Four containers defined in [`docker-compose.yml`](../docker-compose.yml):

```
voting-system/
├── postgres      ← PostgreSQL 15, named volume for persistence
├── redis         ← Redis 7 Alpine, ephemeral (rate limits and JWT blacklist)
├── backend       ← FastAPI application, Python 3.11
└── frontend      ← NGINX serving React SPA + reverse proxy
```

All four containers run on a single Docker Compose-managed bridge network (`voting-system_default`). Every container is reachable from every other container using its **service name as a hostname** — no IP addresses, no host machine ports required for internal communication.

---

## Images

### Backend — `python:3.11-slim`

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 5000
CMD ["python", "server.py"]
```

**Decisions:**
- `python:3.11-slim` — stripped-down base image with no dev tools, smaller attack surface
- `requirements.txt` copied first, then source — Docker layer caching means `pip install` only reruns when dependencies change, not on every code change
- `--no-cache-dir` — prevents pip from storing downloaded packages inside the image
- `EXPOSE 5000` — documents the port; Uvicorn binds to `0.0.0.0:5000` inside the container
- `CMD ["python", "server.py"]` — runs `server.py` which calls `uvicorn.run("main:app", host="0.0.0.0", port=5000)`. The `host="0.0.0.0"` binding is required — `127.0.0.1` would make the service unreachable from other containers

### Frontend — `node:20-alpine` → `nginx:alpine` (multi-stage)

```dockerfile
# Stage 1: Build
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Stage 2: Serve
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

**Decisions:**
- **Multi-stage build** — Node.js (used only for the build step) is discarded. The final image is `nginx:alpine` with only the compiled static files. `node_modules` (~300MB) never enters the final image.
- `package*.json` copied first — same layer caching benefit as the backend: `npm install` only reruns on dependency changes
- `nginx.conf` injected at `/etc/nginx/conf.d/default.conf` — replaces nginx's default config with our proxy configuration
- `daemon off;` — nginx must run in the foreground inside Docker; daemon mode causes the container to exit immediately

---

## Volumes

One named volume is defined:

```yaml
volumes:
  pgdata:
```

PostgreSQL mounts this at `/var/lib/postgresql/data`. This is where PostgreSQL writes all data files, WAL logs, and indexes.

**Behavior:**
- `docker compose down` → containers removed, volume survives → data persists on next `docker compose up`
- `docker compose down -v` → containers AND volumes removed → complete data reset
- The volume persists across image rebuilds — rebuilding the postgres image does not wipe data

Redis has no volume. Rate limit counters and JWT blacklist entries are ephemeral — they expire naturally and do not need to survive restarts.

---

## Health Checks

Health checks ensure containers report `healthy` only when the service inside is actually ready to accept connections, not just when the container process has started.

```yaml
postgres:
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U postgres"]
    interval: 5s
    timeout: 5s
    retries: 5

redis:
  healthcheck:
    test: ["CMD", "redis-cli", "ping"]
    interval: 5s
    timeout: 5s
    retries: 5
```

- `pg_isready -U postgres` — PostgreSQL's built-in readiness tool. Returns exit code 0 when the server is ready to accept connections.
- `redis-cli ping` — Redis responds with `PONG` when healthy.

Both checks run every 5 seconds and must pass 5 consecutive times before the container is marked `healthy`.

---

## Service Dependencies and Startup Ordering

```yaml
backend:
  depends_on:
    postgres:
      condition: service_healthy
    redis:
      condition: service_healthy
```

`condition: service_healthy` means: **do not start the backend until both postgres and redis pass their health checks**.

Without this, Docker Compose would start the backend as soon as postgres and redis containers started — not when PostgreSQL finished initializing its data directory. PostgreSQL takes 2–5 seconds to initialize on first run. The backend would attempt to connect, fail, and crash-loop until postgres was ready.

The health check + dependency condition eliminates this race condition entirely.

---

## Environment Variables and Secrets

Secrets and configuration are kept out of the image and out of the compose file using two mechanisms:

**Root `.env`** — used by Docker Compose for variable substitution in `docker-compose.yml`:
```
DB_PASSWORD=<strong_password>
```

Referenced in compose:
```yaml
POSTGRES_PASSWORD: ${DB_PASSWORD}
```

**`backend/.env`** — loaded by the backend at runtime via `python-dotenv`:
```
DB_PASSWORD=<same_strong_password>
JWT_ACCESS_SECRET=<64-char-hex>
JWT_REFRESH_SECRET=<64-char-hex>
ENCRYPTION_KEY=<32-char-hex>
ADMIN_PASSWORD=<strong_password>
...
```

Referenced in compose:
```yaml
backend:
  env_file:
    - ./backend/.env
```

Both `.env` files are excluded by `.gitignore` (pattern: `.env`, `.env.*`). Only `.env.example` is committed as a template.

**Startup validation:** The backend calls `validate_env()` before accepting any requests. If a required variable is missing or the `ENCRYPTION_KEY` is not exactly 32 bytes, the process exits immediately with a clear error message. This prevents the app from running silently misconfigured.

---

## `.dockerignore`

Both services have `.dockerignore` files to control what enters the Docker build context.

**`backend/.dockerignore`:**
```
__pycache__/
*.py[cod]
*.pyo
.venv/
venv/
env/
.env
*.log
.git/
```

**`frontend/.dockerignore`:**
```
node_modules/
dist/
.env
*.log
.git/
```

`node_modules/` is the most important exclusion — without it, Docker would copy hundreds of megabytes into the build context on every build, even though the multi-stage build runs `npm install` from scratch anyway.

---

## Request Flow

```
docker compose up --build
        │
        ├── postgres starts
        │   └── pg_isready passes (health: healthy)
        │
        ├── redis starts
        │   └── redis-cli ping passes (health: healthy)
        │
        └── backend starts (condition: service_healthy met)
            ├── validate_env() — crash-fast if config is wrong
            ├── apply db/schema.sql (CREATE TABLE IF NOT EXISTS)
            ├── seed admin user (INSERT ... ON CONFLICT DO UPDATE)
            └── uvicorn binds to 0.0.0.0:5000

        frontend starts
        └── nginx binds to port 80, serves /usr/share/nginx/html
```

---

## Networking

Docker Compose creates a default bridge network named `voting-system_default`. All four containers are attached to this network.

Internal hostname resolution:
| Service | Internal hostname | Port |
|---|---|---|
| postgres | `postgres` | `5432` |
| redis | `redis` | `6379` |
| backend | `backend` | `5000` |
| frontend | `frontend` | `80` |

**No container is reachable via `localhost` from another container.** `localhost` inside any container refers to that container's loopback interface, not the host machine or any other container. This is why `DB_HOST=postgres` works and `DB_HOST=localhost` does not.

**Host port exposure:**
| Service | Host Port | Reason |
|---|---|---|
| postgres | — | Internal only in base compose — see `docker-compose.override.yml` |
| redis | — | Internal only |
| backend | — | Internal only — all API traffic routes through NGINX |
| frontend | `5173 → 80` | Single public entry point |

**`docker-compose.override.yml`** — Docker Compose automatically merges this file with the base compose when running locally. It exposes postgres on `5432` to the host so DB tools (pgAdmin, DBeaver, psql) can connect. In production environments, this file is absent — postgres has no host port exposure.

---

## Lessons Learned

**Container started ≠ service ready.** PostgreSQL takes seconds to initialize. Without health checks and `condition: service_healthy`, the backend races against the database and crash-loops on first startup. Health checks are not optional on stateful services.

**`localhost` means the container itself.** Every engineer hits this on their first Docker Compose project. `DB_HOST=localhost` fails because the backend container's localhost has no PostgreSQL process. Service names in Docker Compose act as DNS hostnames across the network.

**Multi-stage builds eliminate production image bloat.** The frontend's final image is `nginx:alpine` with compiled static files — no Node.js runtime, no `node_modules`, no build tooling. This is a material difference in image size, attack surface, and build reproducibility.

**`-v` is irreversible.** `docker compose down -v` destroys named volumes. Data is gone. `docker compose down` preserves volumes. Knowing this distinction before production operations is essential.

**`--no-cache-dir` and layer ordering matter.** Dependencies installed before source code is copied means `pip install` and `npm install` only re-run when dependency files change. Without this, every code change triggers a full reinstall.
