# Incident Reports

Operational failure simulations and real-world debugging exercises performed during the DevOps journey.

Each incident documents a real failure introduced intentionally to understand system behavior, practice debugging, and extract engineering lessons.

---

## Index

| # | Incident | Phase | Status |
|---|---|---|---|
| — | *No incidents documented yet* | — | — |

*Incidents will be added as operational exercises are completed.*

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

What was visible from the outside — what broke, what error messages appeared, what the user experience was.

- Symptom 1
- Symptom 2

---

## Investigation

Step-by-step debugging process. Include actual commands run and output observed.

```bash
docker compose logs backend --tail=20
# output here

docker compose ps
# output here
```

What each command revealed and what the next step was.

---

## Root Cause

Precise technical explanation of why the failure occurred.

---

## Resolution

Exact change made to resolve the issue.

---

## Lessons Learned

What this incident reveals about the system, about Docker/NGINX/the tool involved, and what to watch for in future.

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
