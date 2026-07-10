# INC-005 — CI Smoke Test Failure: Build Passes, Application Fails

**Date:** 2026-07-08
**Phase:** Phase 3 — Continuous Integration
**Severity:** High
**Duration:** ~11 minutes (two CI runs: 5m 26s failure + ~5m fix)
**Status:** ✅ Resolved
**Type:** Intentional failure simulation

---

## What I Was Trying to Learn

After INC-004 proved that CI catches broken infrastructure (bad Dockerfile), this incident tests the harder question:

> *What if the infrastructure is perfect — code clean, images built, containers running — but the application fails anyway because the environment is wrong?*

This is the most dangerous class of failure in CI. It passes every check you can see and fails only when you try to actually use the application.

---

## Summary

The CI workflow was modified to write a wrong `DB_PASSWORD` into the backend's `.env` file while keeping the root `.env` correct. This created a credential mismatch: PostgreSQL initialized with the correct password, the backend tried to connect with the wrong password.

All four build stages passed with no errors. The Docker images were built correctly. The containers started. NGINX was running.

But the backend could not authenticate to PostgreSQL. Every startup attempt failed. The application entered a crash loop. NGINX returned 502 on every request. The smoke test's curl retry exhausted all 30 attempts over 4 minutes 48 seconds before giving up.

**Stage 5 (Application Smoke Test) failed. Stages 1–4 were all green.**

This is the exact scenario the smoke test exists to catch.

---

## What Was Changed

**File:** `.github/workflows/ci.yml` — `Create backend .env` step

```diff
- DB_PASSWORD=${CI_DB_PASSWORD}
+ DB_PASSWORD=wrong_password_inc005_simulation
```

The root `.env` (used by Docker Compose to set `POSTGRES_PASSWORD`) was left unchanged:
```yaml
- name: Create root .env
  run: echo "DB_PASSWORD=${{ secrets.CI_DB_PASSWORD }}" > .env
```

**Result:** PostgreSQL initialized with the correct password. The backend tried to connect with `wrong_password_inc005_simulation`. Authentication failed.

**Why not just change the GitHub Secret?**
If `CI_DB_PASSWORD` is changed in GitHub Secrets, both the root `.env` and the backend `.env` get the same wrong value — they still match. PostgreSQL initializes with the wrong password and the backend connects with the wrong password. Connection succeeds. This teaches nothing.

The mismatch has to be between what PostgreSQL is initialized with and what the backend tries to use. That requires setting them differently in the workflow — exactly the kind of configuration drift that happens in real systems.

---

## Pipeline Behaviour

```
Stage 1 — Lint Backend           ✅  passed   (~25 seconds)
Stage 2 — Validate Frontend      ✅  passed   (~45 seconds)
Stage 3 — Build Backend Image    ✅  passed   (image built correctly)
Stage 4 — Build Frontend Image   ✅  passed   (image built correctly)
Stage 5 — Application Smoke Test ❌  FAILED   (5m 26s total)
  └─ Wait for application        ❌  4m 48s   (30 retries × 5s = 150s + overhead)
  └─ Teardown                    ✅  ran cleanly (if: always())
```

Stage 5 took 5 minutes 26 seconds to fail — 4 minutes 48 seconds of that was the curl retry loop waiting for a backend that was crash-looping.

---

## Observed Error

From the `Show container logs on failure` step in Stage 5:

```
backend-1 | INFO:     Started server process [1]
backend-1 | INFO:     Waiting for application startup.
backend-1 | ERROR:    Traceback (most recent call last):
backend-1 |   File "/app/main.py", line 1180, in on_startup
backend-1 |     conn = db_connect()
backend-1 |            ^^^^^^^^^^^^
backend-1 |   File "/app/main.py", line 101, in db_connect
backend-1 |     return psycopg2.connect(...)
backend-1 |
backend-1 | psycopg2.OperationalError: connection to server at "postgres" (172.18.0.3),
backend-1 | port 5432 failed: FATAL:  password authentication failed for user "postgres"
backend-1 |
backend-1 | ERROR:    Application startup failed. Exiting.
```

This error appeared **three times** — Docker's `restart: always` policy restarted the backend container after each crash. Each restart hit the same error because the password in the `.env` file doesn't change between restarts.

---

## Investigation

**Why did Stages 1–4 pass?**

Environment variables are not part of the Docker image. The Dockerfile copies source code, installs dependencies, and sets a default command. It does not embed passwords, secrets, or any runtime configuration.

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 5000
CMD ["python", "server.py"]
```

The build process succeeds or fails based on the Dockerfile instructions — not on what environment variables will be passed at runtime. `docker build` never reads `DB_PASSWORD`. The wrong password was written to `backend/.env` *after* the image was built, in a separate step.

This is the architectural fact at the center of this incident: **the Docker image is not the application. The application is the image + the environment at runtime.**

**What happened inside the backend container?**

On startup, uvicorn calls the `on_startup` event handler. In `main.py`:

```python
@fastapi_app.on_event("startup")
async def on_startup():
    validate_env()          # ← passes (password is present, just wrong)

    conn = db_connect()     # ← FAILS HERE
    ...
```

`validate_env()` only checks that `DB_PASSWORD` is present and non-empty — it does not test the connection. `db_connect()` makes the actual TCP connection to PostgreSQL and authenticates. PostgreSQL receives the connection request with password `wrong_password_inc005_simulation`, compares it to the stored hash of the correct password, and rejects the connection with:

```
FATAL: password authentication failed for user "postgres"
```

uvicorn catches the exception from `on_startup` and shuts down the server process. Docker detects the exit and — because of `restart: always` — starts a new container. The new container reads the same `.env` file, tries the same wrong password, gets the same error. The crash loop begins.

**Why did the curl retry take 4 minutes 48 seconds?**

```bash
curl \
  --retry 30 \
  --retry-delay 5 \
  --retry-connrefused \
  --retry-all-errors \
  -sf \
  http://localhost:5173/health
```

Each retry: 5 seconds between attempts. 30 retries maximum. During the retry window, the backend container was in a crash loop — starting, failing, exiting, restarting every few seconds. NGINX received requests but the backend upstream was unavailable, so NGINX returned `502 Bad Gateway` on every health check request. `--retry-all-errors` correctly retried on 502 responses. After 30 failed attempts, curl exited with a non-zero code and the step failed.

**Was the teardown correct?**

Yes. The `Teardown` step ran because of `if: always()`:

```yaml
- name: Teardown
  if: always()
  run: docker compose down -v
```

All containers were stopped and removed. The named volume (`pgdata`) was deleted. The network was removed. This cleanup would not have run without `if: always()` — a failed step normally stops subsequent steps in the same job.

**This is the same error as INC-001.**

INC-001 was a PostgreSQL outage — the database stopped and the backend couldn't connect. The error was `FATAL: password authentication failed` (same message, because Docker internal DNS resolved the hostname but auth failed after reconnect attempts). That incident was discovered manually after the fact.

INC-005 is the same class of failure — database connectivity — but caught by CI before the code ever reached production. The smoke test exists precisely because of what INC-001 taught: a health endpoint returning 200 does not prove the database is reachable.

---

## Root Cause

A credential mismatch between two services:
- PostgreSQL was initialized with the correct `DB_PASSWORD`
- The backend's `DB_PASSWORD` was set to `wrong_password_inc005_simulation`

The mismatch originated in the CI workflow's environment file generation step — a misconfiguration in the CI pipeline itself, not in the application code.

In real systems, this class of mismatch occurs when:
- A secret is rotated in one place but not updated everywhere that consumes it
- Staging and production configurations diverge over time
- A secret is copied incorrectly when setting up a new environment
- Infrastructure-as-code references the wrong variable name

---

## Resolution

**File:** `.github/workflows/ci.yml` — `Create backend .env` step

```diff
- DB_PASSWORD=wrong_password_inc005_simulation
+ DB_PASSWORD=${CI_DB_PASSWORD}
```

Fix was pushed to the same branch. CI reran. All 5 stages passed, including Stage 5 (full smoke test). PR was merged. `main` was updated.

---

## What CI Caught

| Without CI | With CI |
|---|---|
| Wrong secret committed and deployed | Wrong secret caught before merge |
| Application crashes in production at first database call | Application crashes in an isolated CI environment |
| Users experience 502 errors | No user impact — failure is invisible to production |
| Root cause requires production log access | Root cause visible immediately in Stage 5 logs |
| Time to detect: whenever a user tries to log in | Time to detect: 5m 26s after push |

---

## The 4-Minute Timeout is a Design Signal

The smoke test took 4 minutes 48 seconds to declare failure. This is expensive for a CI pipeline. In a real production CI system, this would prompt an engineering conversation:

**Option 1 — Reduce retries for faster feedback:**
```bash
curl --retry 10 --retry-delay 3   # max 30s wait instead of 150s
```
Trade-off: might get false failures if the stack takes longer to start on a slow runner.

**Option 2 — Add a specific backend health endpoint that returns 503 while the DB is unreachable:**
The backend starts accepting connections even while `on_startup` is running. A health endpoint that checks DB connectivity could return `503 Service Unavailable` immediately — no need to wait for curl to time out.

**Option 3 — Add startup probes to docker-compose:**
Use Docker's `healthcheck` on the backend service to detect crash loops faster.

For Phase 3, the 150-second timeout is acceptable. This is a known trade-off documented here.

---

## Key Learnings

**1. Build success ≠ Application success.**
Four stages of CI validation — lint, Vite build, backend Docker build, frontend Docker build — all passed. The application was broken. The smoke test is what proved it.

**2. Docker images do not contain environment configuration.**
The image is a blueprint. The application is the image + environment at runtime. You cannot validate the application by validating the image alone.

**3. Credential mismatches are silent until runtime.**
The wrong password was present in the `.env` file — not missing. `validate_env()` saw a non-empty value and passed. The application *looked* configured. The mismatch was only revealed when a real connection was attempted.

**4. `restart: always` makes crash loops visible.**
The same error appeared three times in the logs, making it immediately clear that the container was restarting — not just slow to start. Without `restart: always`, the container would have exited and stayed dead, which would have been harder to distinguish from "container not yet started."

**5. `if: always()` is not optional.**
The teardown step ran despite Stage 5 failing. If teardown didn't run, CI runners would accumulate orphaned containers and volumes across every failed run.

**6. CI caught what INC-001 didn't.**
INC-001 was the same class of failure — database connectivity — discovered in production after the fact. This time, CI caught it in isolation before it could reach any user.

---

## Prevention

- After rotating any database credential, verify that every `.env`, workflow file, and secret that references it is updated
- Add a startup health check to the backend that explicitly tests database connectivity and returns 503 until the database is reachable — fail fast at the application layer, not the curl retry layer
- In CI, treat the smoke test failure as a configuration audit trigger: if the application can't start, check all secrets against all services before investigating code
