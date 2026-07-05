# Phase 3 — Continuous Integration

**Goal:** Automatically validate every code change against lint, build, and a full-stack smoke test before it is considered mergeable. No manual verification. No "works on my machine."

---

## Why CI Was Introduced

Before Phase 3, every code change required manual validation:

- Pull the latest code
- Rebuild Docker images locally
- Start the full stack
- Manually test that the application still works
- Decide whether it was "good enough" to push

This process had two problems.

**Problem 1 — It didn't scale.** As the codebase grows, manual validation becomes slower and less reliable. Steps get skipped. Assumptions get made. Broken changes reach the repository.

**Problem 2 — It had no enforcement.** There was nothing stopping a broken Dockerfile, a syntax error, or a wrong environment variable from being committed. The only catch was if someone noticed.

CI solves both problems by making validation automatic, consistent, and mandatory on every push.

---

## CI vs CD — Why Only CI at This Stage

**Continuous Integration (CI)** means every code change is automatically validated against the full build and test pipeline. If validation fails, the change is rejected before it merges.

**Continuous Deployment (CD)** means validated changes are automatically deployed to an environment — staging, production, or both.

Phase 3 implements CI only. CD is Phase 4 (cloud deployment).

This separation is deliberate. Automating deployment to infrastructure that doesn't exist yet is premature work. CI delivers value immediately — on every push — without any cloud infrastructure. CD requires a deployment target first.

This is also how real engineering teams structure the progression:
- CI first — validate the code
- CD after — automate the release

---

## The Pipeline

The CI pipeline is a GitHub Actions workflow defined in `.github/workflows/ci.yml`.

### Trigger

```yaml
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
```

Push to `main` — pipeline runs. Pull request targeting `main` — pipeline runs. Push to any other branch — nothing runs.

The PR trigger is significant. It means CI validates changes *before* they reach `main`. The standard professional workflow is:

```
Developer → Feature Branch → Push → CI runs
                                        ↓
                                   Pull Request
                                        ↓
                                   CI runs again
                                        ↓
                                     Merge
                                        ↓
                                       main
                                        ↓
                                   CI runs on main
```

For this project, direct pushes to `main` are used for simplicity. Production teams use PRs exclusively — broken code never touches `main` because the CI gate blocks the merge.

### Stage Order — Sequential, Fail Fast

```
Stage 1: Lint Backend
            ↓ (must pass)
Stage 2: Validate Frontend Build
            ↓ (must pass)
Stage 3: Build Backend Docker Image
            ↓ (must pass)
Stage 4: Build Frontend Docker Image
            ↓ (must pass)
Stage 5: Application Smoke Test
```

Each stage only runs if the previous stage passed. This is the **fail-fast principle**: reject the change as early and as cheaply as possible.

Lint is the cheapest stage — it runs in seconds with no Docker overhead. If a developer commits a syntax error, the pipeline rejects it in under 30 seconds — not after waiting 5 minutes for a Docker build.

Build is expensive. Only run it on code that has already passed linting.

Smoke test is the most expensive — it starts the full stack. Only run it after the images have been verified to build successfully.

The ordering is: cheap → expensive, fast → slow.

### Why Sequential and Not Parallel

Lint Backend and Lint Frontend are independent — they could theoretically run in parallel. So could the two build jobs.

Parallelism is an optimization that trades readability for speed. The first version of any pipeline should be sequential so the flow can be read top to bottom and understood completely. Once the pipeline is stable and the team understands every stage, parallelizing independent jobs is a straightforward change.

Optimization after understanding. Not before.

---

## Stage-by-Stage

### Stage 1 — Lint Backend

**Tool:** ruff

**What it does:** Runs static analysis against the entire `backend/` directory. Checks for unused imports, undefined names, syntax errors, and code style violations.

**Why ruff over flake8:** ruff is a modern Python linter written in Rust. It is 10–100x faster than flake8 and replaces multiple tools (flake8, isort, pyflakes) in a single binary. It is the current industry standard for Python linting.

**Setup required:**
```yaml
- uses: actions/setup-python@v5
  with:
    python-version: "3.11"
- run: pip install ruff
- run: ruff check backend/
```

The runner starts clean — no Python, no ruff. Each step installs what it needs. This is intentional: it proves the project can be built from nothing, not just on a machine where dependencies happen to be installed.

**Fail example — what ruff caught:**
```
F401 [*] `unused_ci_test_module` imported but unused
 --> backend/main.py:2:8
```

`F401` is the ruff rule code for an unused import. The `[*]` means ruff knows how to auto-fix it. The output tells you exactly where the problem is and what to do about it.

---

### Stage 2 — Validate Frontend Build

**Tool:** Vite (via `npm run build`)

**Why not ESLint:** ESLint is not configured in this project. Rather than adding ESLint as part of the CI implementation (two changes at once), Vite's own build process serves as the quality gate. If the JavaScript or JSX has errors that prevent compilation, `npm run build` fails and the pipeline stops here.

**Setup required:**
```yaml
- uses: actions/setup-node@v4
  with:
    node-version: "20"
- run: npm ci
  working-directory: frontend
- run: npm run build
  working-directory: frontend
```

`npm ci` is used instead of `npm install`. `ci` installs exactly what is in `package-lock.json` — no version resolution, no surprises. It is the correct command for automated environments.

**Why this stage runs before the Docker build:** Running Vite directly on the runner is faster than the Docker build (no image layer overhead) and produces clearer error messages. If the JavaScript has a compile error, you see the Vite output directly — not buried in Docker build logs.

---

### Stage 3 — Build Backend Docker Image

```bash
docker build -t votesecure-backend ./backend
```

**What it validates:**
- The `backend/Dockerfile` has no syntax errors
- All `pip install` dependencies resolve successfully
- The Python code has no import errors that prevent module loading
- The image can be built from scratch on a clean machine

**Why not push to a registry:** There is no deployment target yet. Pushing an image to Docker Hub or GitHub Container Registry is only useful if something pulls and deploys it. That is Phase 4. Pushing to a registry in Phase 3 creates infrastructure with no consumer.

---

### Stage 4 — Build Frontend Docker Image

```bash
docker build -t votesecure-frontend ./frontend
```

**What it validates:**
- The multi-stage `frontend/Dockerfile` works end-to-end
- `npm run build` succeeds inside Docker (the Vite build in Stage 2 ran on the runner; this confirms it also works inside the Docker build environment)
- The NGINX configuration in the final image is syntactically valid
- The static files are correctly copied to `/usr/share/nginx/html`

The multi-stage build means two environments are validated: the Node.js build environment and the nginx:alpine serving environment.

---

### Stage 5 — Application Smoke Test

The most important stage.

**What it does:**

1. Writes environment files from GitHub Secrets
2. Runs `docker compose up -d --build` — full 4-container stack
3. Waits for the application to be ready using `curl --retry`
4. Runs three checks
5. Tears down with `docker compose down -v`

**The three checks:**

```
Check 1: GET /health
         → expect {"status": "ok"}
         Proves: FastAPI process is alive

Check 2: GET /api/elections
         → expect 401 Unauthorized
         Proves: NGINX is proxying, backend is responding,
                 authentication layer is active

Check 3: POST /api/auth/login
         → expect 200 + accessToken in body
         Proves: PostgreSQL is connected, schema was applied,
                 admin user was seeded, JWT signing works
```

**Why three checks and not just `/health`:**

Check 1 (`/health`) only proves the FastAPI process started. The health endpoint does not touch the database. This was demonstrated in INC-001 — the health endpoint returned 200 while PostgreSQL was stopped and all database operations were failing.

Check 2 (`/api/elections` → 401) proves the entire proxy chain works: browser → NGINX → backend API → authentication middleware. No credentials needed.

Check 3 (login) is the definitive check. It proves PostgreSQL is reachable, the schema tables exist, the admin user was inserted, password hashing works, and JWT signing produces a valid token. If the database is misconfigured in any way — wrong host, wrong password, wrong schema — this check fails.

**The wait strategy:**

```bash
curl \
  --retry 30 \
  --retry-delay 5 \
  --retry-connrefused \
  --retry-all-errors \
  -sf \
  http://localhost:5173/health
```

After `docker compose up -d`, the containers are starting but the stack is not immediately ready. PostgreSQL needs to pass its health check (`pg_isready`), Redis needs to pass its check (`redis-cli ping`), and only then does the backend start (enforced by `depends_on: condition: service_healthy`). The backend then runs `validate_env()` and applies the database schema.

The `curl --retry 30 --retry-delay 5` retries for up to 150 seconds (30 × 5s). `--retry-connrefused` retries even if the connection is refused. `--retry-all-errors` retries even on HTTP error responses (like 502 while the backend is starting). Together, they wait patiently for the application to be fully ready.

---

## GitHub Secrets

The integration smoke test needs real environment values to start the stack. These are stored as GitHub Secrets — encrypted at rest, masked in logs, injected as environment variables at runtime.

| Secret | Purpose |
|---|---|
| `CI_DB_PASSWORD` | PostgreSQL password |
| `CI_JWT_ACCESS_SECRET` | JWT signing key |
| `CI_JWT_REFRESH_SECRET` | JWT refresh signing key |
| `CI_ENCRYPTION_KEY` | AES-256 key — must be exactly 32 bytes |
| `CI_ADMIN_EMAIL` | Admin account email for smoke test login |
| `CI_ADMIN_PASSWORD` | Admin account password for smoke test login |

**Why secrets are not hardcoded in the workflow file:**

The workflow file is committed to the repository and visible to everyone. Hardcoding credentials there exposes them publicly. GitHub Secrets are stored encrypted and are never printed in logs — even if a step prints the value, GitHub masks it.

**How secrets reach the `.env` file:**

```yaml
- name: Create backend .env
  env:
    CI_DB_PASSWORD: ${{ secrets.CI_DB_PASSWORD }}
    ...
  run: |
    cat > backend/.env << EOF
    DB_PASSWORD=${CI_DB_PASSWORD}
    ...
    EOF
```

Secrets are first mapped to shell environment variables in the `env:` block. Then the heredoc writes them to `backend/.env`. This two-step approach prevents the secret values from appearing directly in the workflow YAML.

---

## The PR Workflow in Practice

This is what was validated during Phase 3:

**Round 1 — Intentional lint failure (INC-004):**

```
Branch: test/lint-failure-gate
Change: add `import unused_ci_test_module` to main.py
Result: Stage 1 (Lint Backend) → F401 error, exit code 1
        Stages 2-5 → did not run
```

The pipeline rejected the broken commit at Stage 1. Stages 2-5 never ran — no wasted build time, no partial validation.

**Round 2 — Fix applied:**

```
Commit: remove unused import
Result: All 5 stages → green
```

The PR was then merged to `main`. Merge triggered a third CI run on `main` — also green. This is the correct final state: `main` is always the branch that CI has verified.

---

## Key Concepts

**Workflow** — a YAML file in `.github/workflows/` that defines the automation. Each repository can have multiple workflows.

**Runner** — the virtual machine that executes the workflow. GitHub provides Ubuntu, Windows, and macOS runners. Each job starts on a fresh runner — no state from previous jobs.

**Job** — one unit of work. Runs on a single runner. Has its own fresh environment.

**Step** — one command inside a job. Steps share the same runner and filesystem.

**`needs`** — the keyword that creates dependencies between jobs. `needs: lint-backend` means this job only runs after `lint-backend` completes successfully.

**Quality Gate** — a stage that must pass before the next stage runs. The entire value of CI is in the quality gates.

**`if: failure()`** — a step condition. `Show container logs on failure` only runs when a previous step failed. This is how you get debugging information without cluttering successful runs.

**`if: always()`** — a step condition. `Teardown` runs whether the job succeeded or failed. Without this, a failed smoke test would leave containers running on the CI runner.

---

## What Was Not Done (and Why)

**No ESLint** — ESLint is not configured in the frontend project. Adding it as part of the CI implementation would change two things simultaneously: the CI pipeline and the frontend toolchain. The Vite build serves as the quality gate for now.

**No unit tests** — the backend has no pytest tests. Adding meaningful tests is its own work stream. The integration smoke test provides more coverage with less test code.

**No Docker registry push** — no deployment target exists yet. Phase 4 adds the registry push and deployment step.

**No parallel jobs** — sequential first. Parallelism is an optimization applied after the pipeline is understood and stable.

---

## What Phase 3 Delivers

**Before Phase 3:**
> Validating that the application still works after a change is manual and inconsistent.

**After Phase 3:**
> Every push to `main` is automatically validated against lint, build, and a full-stack smoke test. If any stage fails, the push is visible as failing in GitHub. Main is always the branch that CI has verified.

This is the foundation for Phase 4 (automated deployment). A deployment pipeline that doesn't first validate the code is automation without a safety net.

→ [CI Workflow](.github/workflows/ci.yml)
→ [Incident Reports](docs/incidents/)
