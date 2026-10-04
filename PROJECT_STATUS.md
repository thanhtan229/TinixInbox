# PROJECT_STATUS.md

> **Current Project Execution Snapshot**
>
> This document records the current durable state of the project so another coding agent or a future session can resume quickly.
>
> It is a snapshot, not a chronological development log.

---

## 0. Status Metadata

**Project:** TBD  
**Overall Status:** Active | Blocked | Stable | Completed  
**Current Phase:** TBD  
**Last Updated:** YYYY-MM-DD  

---

## 1. Current Objective

Describe the single most important current objective.

Keep this brief.

Example structure:

`Complete [current feature/phase] so that [expected result].`

---

## 2. Current State Summary

Summarize the present project state in a few bullets.

- TBD
- TBD
- TBD

This section should let a new agent understand the project checkpoint without reading the full history.

---

## 3. Completed

List meaningful completed milestones or durable work that still matters for the next steps.

- [x] TBD
- [x] TBD
- [x] TBD

Do not list every small commit or code edit.

Remove obsolete detail over time.

---

## 4. In Progress

For each active item, include only useful continuation context.

### TBD

**Status:** In Progress  
**What is done:** TBD  
**What remains:** TBD  
**Relevant area/files:** TBD  

---

## 5. Blockers / Known Issues

If none:

`None.`

Otherwise:

### Blocker / Issue 1

**Problem:** TBD  
**Evidence:** TBD  
**Impact:** TBD  
**Current understanding:** TBD  
**Next diagnostic/action:** TBD  

Distinguish verified facts from hypotheses.

---

## 6. Important Recent Decisions

Record only decisions that materially affect the next work.

- TBD
- TBD

Do not duplicate durable architectural decisions already documented in `ARCHITECTURE.md`.

---

## 7. Verification State

Record the latest meaningful verification state.

```text
Targeted tests: TBD
Full tests: TBD
Typecheck: TBD
Lint: TBD
Build: TBD
Runtime: TBD
Health check: TBD
Known pre-existing failures: TBD
```

Do not mark something as passing if it was not run.

---

## 8. Runtime / Environment State

Include only if useful for resuming work.

```text
Frontend: TBD
Backend: TBD
Local services: TBD
Database: TBD
Current development mode: TBD
Relevant process/runtime notes: TBD
```

Avoid transient process IDs unless they are genuinely needed for resume context.

---

## 9. Next Actions

List the next actions in priority order.

1. TBD
2. TBD
3. TBD

Keep this actionable.

Do not turn this into a long roadmap; the roadmap belongs in `PLAN.md`.

---

## 10. Resume Context

This is the most important section for a new session or a different coding agent.

Include the minimum information needed to continue without re-investigating the entire project.

```text
Start here:
- TBD

Read first:
- TBD

Current implementation checkpoint:
- TBD

Do not redo:
- TBD

Next expected action:
- TBD

Important caveat:
- TBD
```

---

## 11. Relevant Documents

Use only documents that actually exist.

```text
AGENTS.md
DEVELOPMENT_WORKFLOW.md
UX_UI.md
ARCHITECTURE.md
PLAN.md
Other relevant spec: TBD
```

---

## 12. Status Maintenance Rule

Update `PROJECT_STATUS.md` when there is a meaningful durable checkpoint, such as:

- a phase completed;
- the active objective changed;
- a significant blocker appeared or was resolved;
- a major decision changed the next work;
- a long session is ending and continuation context should be preserved.

Do **not** update this file after every small code change.

Always maintain it as the current snapshot.

Do not append an endless history.

Remove or replace stale information.

---

## 13. Relationship to Other Documents

```text
PLAN.md
→ What are we planning to do?

PROJECT_STATUS.md
→ Where are we now?

ARCHITECTURE.md
→ How is the system currently structured?
```

Do not duplicate information unnecessarily across these files.
