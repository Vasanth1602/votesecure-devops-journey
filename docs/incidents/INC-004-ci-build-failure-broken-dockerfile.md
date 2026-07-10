# INC-004 — CI Pipeline Build Failure: Broken Dockerfile

**Date:** 2026-07-07
**Phase:** Phase 3 — Continuous Integration
**Severity:** Medium
**Duration:** ~6 minutes (two CI runs: failure + fix)
**Status:** ✅ Resolved
**Type:** Intentional failure simulation

---

## What I Was Trying to Learn

After the CI pipeline passed on its first push, the question was: does the build stage actually catch anything, or does it just run and pass because the code already works?

The goal was to verify that Stage 3 (Build Backend Image) is a real quality gate — not just a checkbox:

> *If a Dockerfile references a file that doesn't exist, does CI stop the pipeline before anything else runs? Or does the failure propagate further?*

---

## Summary

The `backend/Dockerfile` was intentionally broken by changing the `COPY` source path from `requirements.txt` to a file that does not exist (`requirements_BROKEN.txt`). This simulates a realistic real-world mistake — a filename typo, a renamed file, or a forgotten step when reorganizing the project structure.

The CI pipeline detected the failure at **Stage 3 (Build Backend Image)**. Stages 1 and 2 passed cleanly. Stages 4 and 5 were skipped entirely — they never ran.

The broken commit was kept on a feature branch and never reached `main`. The PR workflow meant `main` stayed clean throughout.

---

## What Was Changed

**File:** `backend/Dockerfile`, line 5

```diff
- COPY requirements.txt ./
+ COPY requirements_BROKEN.txt ./
```

`requirements_BROKEN.txt` does not exist in the `backend/` directory. The file `requirements.txt` is the real dependency file. This single character change is enough to make the entire Docker build fail.

---

## Pipeline Behaviour

```
Stage 1 — Lint Backend           ✅  passed   (~25 seconds)
Stage 2 — Validate Frontend      ✅  passed   (~45 seconds)
Stage 3 — Build Backend Image    ❌  FAILED   ← stopped here
Stage 4 — Build Frontend Image   ⏭  skipped  (never ran)
Stage 5 — Application Smoke Test ⏭  skipped  (never ran)
```

The pipeline failed at Stage 3 and went no further. This is the fail-fast principle in action.

---

## Observed Error

Exact error from the GitHub Actions log (Stage 3):

```
#5 [2/4] COPY requirements_BROKEN.txt ./
#5 ERROR: failed to compute cache key:
failed to calculate checksum of ref
722b12b9-7eb1-4cee-a2d9-9d7732c475ca::xui0nj6ny1he5mh770tnejwjx:
"/requirements_BROKEN.txt": not found
------
ERROR: failed to build: failed to solve: failed to compute cache key:
failed to calculate checksum of ref ...:
"/requirements_BROKEN.txt": not found
Error: Process completed with exit code 1.
```

The error is a **Docker build context error**. Docker scans the build context (the `backend/` directory) for the file named in the `COPY` instruction. When the file is not found, the build fails immediately at that layer — before `pip install` runs, before any Python code is loaded, before any image is created.

---

## Investigation

**Why did Stages 1 and 2 pass?**

Stage 1 (ruff) checks Python source code syntax and style. The Dockerfile is not Python — ruff does not read it. Stage 2 (Vite build) runs in the `frontend/` directory. Neither stage has any awareness of the Dockerfile.

This reveals an important point: **lint passes do not mean infrastructure is correct.** The code can be perfectly clean while the build configuration is broken.

**Why did Stages 4 and 5 not run?**

The `needs` keyword in the workflow creates a dependency chain:

```yaml
build-backend:
  needs: validate-frontend   # Stage 3 needs Stage 2

build-frontend:
  needs: build-backend       # Stage 4 needs Stage 3

smoke-test:
  needs: build-frontend      # Stage 5 needs Stage 4
```

When Stage 3 fails, GitHub Actions marks it as failed and immediately skips all downstream jobs. Stages 4 and 5 never start. No compute is wasted. No partial state is created.

**Could this have been caught locally?**

Yes — but only if the developer ran `docker build` locally. If Docker has a cached layer from a previous build that included `requirements.txt`, the cached layer would be used and the missing file would not be detected. On the CI runner, there is no cache. Every build starts from scratch.

This is one of the key values of CI: it builds on a **clean machine** with no local assumptions, no cached layers, no "it works because it was already built last week."

**What does the error actually mean?**

```
failed to compute cache key: ... "/requirements_BROKEN.txt": not found
```

Docker BuildKit computes a cache key for each layer before building it. To compute the cache key for a `COPY` instruction, it needs to hash the file being copied. If the file doesn't exist in the build context, it can't hash it, so it fails before the actual copy even begins. This is why the error says "cache key" — it's failing at the cache computation step, not the copy step.

---

## Root Cause

A single character change in the Dockerfile — `requirements.txt` → `requirements_BROKEN.txt` — caused the Docker build to fail because the referenced file does not exist in the build context.

**Realistic versions of this mistake:**
- Renaming `requirements.txt` to `requirements-prod.txt` without updating the Dockerfile
- Moving files into a subdirectory and forgetting to update the COPY path
- A copy-paste error when writing the Dockerfile for a new service
- Merging a branch that reorganized files without updating the Dockerfile

---

## Resolution

**File:** `backend/Dockerfile`, line 5

```diff
- COPY requirements_BROKEN.txt ./
+ COPY requirements.txt ./
```

Fix was pushed to the same branch. CI reran:

```
Stage 1 — Lint Backend           ✅  passed
Stage 2 — Validate Frontend      ✅  passed
Stage 3 — Build Backend Image    ✅  passed
Stage 4 — Build Frontend Image   ✅  passed
Stage 5 — Application Smoke Test ✅  passed
```

PR was merged. `main` was updated. The broken Dockerfile never reached `main` at any point.

---

## What CI Caught

| Without CI | With CI |
|---|---|
| Broken Dockerfile committed to `main` | Broken Dockerfile stopped at Stage 3 |
| Other developers pull a broken build environment | PR blocked — no merge until fixed |
| Discovered later when someone tries to build | Discovered in 70 seconds (Stages 1-2 runtime) |
| Docker cache may hide the problem locally | Clean runner — no cache, no hiding |

---

## Key Learnings

**1. Lint passing does not mean the build works.**
Stages 1 and 2 passed cleanly. The code was perfectly clean. The Dockerfile was broken. These are different failure domains. A complete CI pipeline needs to validate both.

**2. CI builds on a clean machine.**
The CI runner has no Docker build cache. Every layer is built from scratch. This means CI will catch file-not-found errors that a developer's local machine might hide because the layer was already cached from a previous successful build.

**3. The `needs` dependency chain is the fail-fast mechanism.**
Skipping Stages 4 and 5 is not accidental — it's the explicit design of the `needs` keyword. The pipeline stops as soon as a quality gate fails. No partial results, no wasted compute, no false state.

**4. The error message tells you exactly what to fix.**
```
"/requirements_BROKEN.txt": not found
```
This is unambiguous. The file name is in the error. Docker is not cryptic here — it tells you precisely what it was looking for and couldn't find.

**5. The PR workflow contained the damage.**
The broken Dockerfile existed for approximately 6 minutes — the time between the first push and the fix merge. At no point during those 6 minutes did `main` contain the broken change. The PR workflow is not just a process preference; it is an actual containment mechanism.

---

## Prevention

- After renaming or moving files in the repository, search for COPY references in all Dockerfiles
- Run `docker build` locally (without `--cache-from`) before pushing infrastructure changes
- The CI pipeline is the safety net for when these checks are missed
