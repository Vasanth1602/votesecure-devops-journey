# Incident Reports

Operational failure simulations and real-world debugging exercises performed during the DevOps journey.

Each incident documents a real failure introduced intentionally to understand system behavior, practice debugging, and extract engineering lessons.

---

## Index

| # | Incident | Phase | Status |
|---|---|---|---|
| [INC-001](INC-001-postgresql-outage.md) | PostgreSQL Container Outage | Phase 1 — Containerization | ✅ Resolved |

*More incidents will be added as operational exercises are completed.*

---

## Simulation Tip

When actively simulating failures, `restart: always` on the service under test causes it to recover and restart automatically — wiping the failure state before you can inspect it. Temporarily set `restart: "no"` on the service being tested:

```yaml
# In docker-compose.override.yml while simulating
services:
  backend:
    restart: "no"
```

This lets you inspect the exit state cleanly with `docker compose logs` and `docker compose ps` before recovering.

---

## Incident Report Template

Use the following structure for every incident:

```markdown
# INC-XXX — [Short Title]

**Date:** YYYY-MM-DD
**Phase:** Phase N — [Phase Name]
**Severity:** Low / Medium / High
**Duration:** X minutes
**Status:** Resolved

---

## Summary

One paragraph describing what happened, what was affected, and how it was resolved.

---

## Symptoms

What was visible from the outside — error messages, user experience, what broke and what kept working.

- Symptom 1
- Symptom 2

---

## Discovery

How was the failure detected? Log line? Health check failure? User-visible error? Browser DevTools?

---

## Investigation

Step-by-step debugging process. Include actual commands run and output observed.

```bash
docker compose logs backend --tail=20
# output observed

docker compose ps
# output observed
```

What each step revealed and what the next step was.

---

## Root Cause

Precise technical explanation of why the failure occurred.

---

## Resolution

Exact change made to resolve the issue.

---

## Detection Gap

How monitoring or alerting would catch this in production — before a user reports it.
What metric, log pattern, or health check would expose this failure automatically?

---

## Prevention

What configuration, process, or architecture change would prevent this class of failure from recurring?

---

## Lessons Learned

What this incident reveals about the system and the tools involved.

---

## LinkedIn Post

The engineering story written for public documentation of this incident.
```

---

## Naming Convention

Files named: `INC-XXX-short-description.md`

Examples:
- `INC-001-backend-crash-loop-db-host.md`
- `INC-002-502-wrong-upstream-port.md`
- `INC-003-spa-refresh-404.md`
