# INC-006 — CI Pipeline Never Starts: Wrong Workflow Trigger

**Date:** 2026-07-09
**Phase:** Phase 3 — Continuous Integration
**Severity:** Critical
**Duration:** ~8 minutes (two CI states: complete silence + fix verification)
**Status:** ✅ Resolved
**Type:** Intentional failure simulation

---

## What I Was Trying to Learn

INC-004 showed that CI catches broken infrastructure. INC-005 showed that CI catches broken runtime configuration. This incident asks the most fundamental question of all:

> *What happens if CI itself is broken? Not "fails" — but never runs at all?*

A pipeline that fails tells you something. A pipeline that doesn't run tells you nothing — and you won't know it isn't running.

---

## Summary

The CI workflow trigger was changed to target a branch named `production` instead of `main`:

```yaml
on:
  push:
    branches: [production]
  pull_request:
    branches: [production]
```

A feature branch was pushed. A pull request targeting `main` was opened.

The GitHub Actions tab showed **zero workflow runs**. The PR showed **no CI checks**. No red. No yellow. No warning. GitHub's UI indicated the PR was ready to merge — because nothing was blocking it.

The application code could have been broken in any way. There was no gate. No one would have known.

---

## What Was Changed

**File:** `.github/workflows/ci.yml`, lines 3–7

```diff
 on:
   push:
-    branches: [main]
+    branches: [production]
   pull_request:
-    branches: [main]
+    branches: [production]
```

`production` is not a branch in this repository. The trigger is syntactically valid YAML — GitHub parses it without error. But it never fires because no push or PR ever targets a branch called `production`.

---

## What Was Observed

**GitHub Actions tab:** No new workflow runs appeared after the push or after the PR was opened. The most recent run shown was from INC-005.

**GitHub PR page:** No status checks. No "CI / Lint Backend" check. No pending state. No failed state. The PR was marked as mergeable with no quality gate blocking it.

**The experience from the developer's perspective:**
1. Push code
2. Open PR
3. Wait for CI
4. CI never comes
5. There is no visual indicator that something is wrong — just absence

This is the most dangerous failure mode in automation: **silent failure**.

---

## Investigation

**Why does changing `[main]` to `[production]` silence the pipeline entirely?**

GitHub Actions evaluates workflow triggers based on two things: the event type and the branch pattern. When a push occurs to `test/wrong-trigger-inc006`, GitHub checks whether any workflow file in `.github/workflows/` has a trigger matching that event and branch. The `ci.yml` file says:

```yaml
on:
  push:
    branches: [production]
```

The branch `test/wrong-trigger-inc006` does not match `production`. No trigger fires. No run is queued.

When a PR targeting `main` is opened, GitHub checks whether any workflow has a `pull_request` trigger matching the base branch (`main`). The `ci.yml` file says:

```yaml
pull_request:
  branches: [production]
```

The target branch `main` does not match `production`. No trigger fires.

Result: the workflow exists on disk. GitHub has read it. But it has no reason to run it for any event that actually occurs in this repository.

**Is there any warning?**

No. GitHub does not alert you that a workflow exists but never matches any events. There is no "dead workflow" indicator. There is no email, no notification, no badge going red.

The only way to detect this is:
1. Notice that CI checks are missing from a PR that should have them
2. Actively check the Actions tab and observe no recent runs
3. Have external monitoring that alerts when no CI run has occurred in N hours on an active repository

**Why is this rated Critical when it seems like a simple typo?**

Because the failure mode is invisible confidence. After this change, every developer on the team sees:
- PRs that open without CI
- Merges that complete without CI validation
- `main` that looks clean because there are no red indicators

The application could have broken Dockerfiles, wrong secrets, lint errors, failed builds — and none of it would be caught. The team would believe CI is protecting them. It isn't.

**How does this compare to INC-004 and INC-005?**

| Incident | What failed | Failure mode |
|---|---|---|
| INC-004 | Dockerfile | ❌ Visible — Stage 3 goes red |
| INC-005 | Runtime secret | ❌ Visible — Stage 5 goes red |
| INC-006 | CI trigger | 🔇 Invisible — nothing happens at all |

INC-006 is the only incident where GitHub showed no failure indicator. The pipeline was completely silent.

---

## Root Cause

Both workflow triggers (`push` and `pull_request`) referenced a branch name (`production`) that does not exist in the repository. The YAML was syntactically valid, so GitHub parsed it without error. But the trigger condition never matched any real event, so the workflow never executed.

**Realistic versions of this mistake:**
- Renaming `main` to `master` (or vice versa) without updating workflow files
- Copying a workflow from another repository that used `develop` as the primary branch
- Adding a new branch protection rule that doesn't match the workflow trigger
- Configuring CI for a branch you intend to create later and forgetting

---

## Resolution

**File:** `.github/workflows/ci.yml`, lines 3–7

```diff
 on:
   push:
-    branches: [production]
+    branches: [main]
   pull_request:
-    branches: [production]
+    branches: [main]
```

The fix was pushed to the same branch. Because the `pull_request` trigger was restored to `[main]`, the PR immediately triggered a CI run. All 5 stages passed. The PR was merged. `main` was updated.

---

## What This Proved

The first commit on this branch (wrong trigger) produced no CI run.
The second commit on the same branch (fixed trigger) produced a full CI run.

Two commits. Same branch. Same PR. Completely different CI behavior. The only difference was two characters in the workflow file: `production` vs `main`.

---

## Key Learnings

**1. A misconfigured trigger is worse than a failing pipeline.**
A failing pipeline is visible. A silenced pipeline creates false confidence. You believe you are protected when you are not.

**2. The CI pipeline itself is infrastructure.**
Like NGINX, PostgreSQL, and Docker — the CI system can be misconfigured. It needs to be treated with the same care as any other piece of infrastructure. It can fail silently. It should be monitored.

**3. GitHub does not validate that workflow triggers will ever fire.**
GitHub validates YAML syntax. It does not warn you if your trigger pattern can never match a real event in your repository. The responsibility for correctness falls entirely on the engineer.

**4. After any branch rename or repository restructuring, verify CI triggers explicitly.**
Renaming `main` → `master`, splitting a monorepo, or changing branch strategies are all operations that can silently break CI triggers. Always open a test PR after structural changes and confirm CI actually runs.

**5. Monitor CI activity, not just CI results.**
A green pipeline is good. No pipeline is dangerous. Monitoring should alert not just on failures but on absence: if no CI run has occurred in an active repository within N hours, something is wrong.

---

## Prevention

- After any branch naming change, open a test PR and verify CI triggers appear before merging anything else
- Add a branch protection rule requiring the CI check to pass before merging — this turns a silent failure (no CI) into a blocking failure (PR cannot merge without CI)
- Consider adding an external monitoring check that verifies CI runs occurred recently on the repository

---

## The Three-Incident Story

| Incident | Failure Layer | What You See | Time to Detect |
|---|---|---|---|
| INC-004 | Build | ❌ Stage 3 red | ~70 seconds |
| INC-005 | Runtime | ❌ Stage 5 red after 5m 26s | ~5m 26s |
| INC-006 | CI itself | 🔇 Nothing | Never (unless monitored) |

The severity increases as visibility decreases. INC-004 is the most obvious. INC-006 is the most dangerous.
