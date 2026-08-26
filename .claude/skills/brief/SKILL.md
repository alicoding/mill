---
name: brief
description: Compose a dispatch brief for a builder agent (goal 0192's context-completeness discipline). Use EVERY time an Agent dispatch is about to be written — before the prompt is drafted, not after. Loads the divergence list and the checklist that keeps a smaller model inside this project's patterns instead of the industry-familiar ones.
---

# Writing a dispatch brief

The failure this skill exists to prevent (goal 0192, `defect_class:
familiar-pattern-fallback`): with incomplete context, any reader —
orchestrator included — falls back on the industry-familiar pattern,
which is right often enough to fail silently at the boundaries. Brief
completeness must RISE as the executing model tier drops; a Sonnet
brief carries more, not less, than an Opus one would need.

## Before drafting

1. Read `divergences.md` in this folder. Copy into the brief every
   divergence whose area the task touches — as written, not
   paraphrased. If the task exposes a divergence not yet on the list,
   ADD it to `divergences.md` in the same change.
2. Check each constraint you are about to state against the code, and
   against the other constraints (three briefs in one arc shipped
   impossibilities; one brief told an agent to update SPEC.md while
   forbidding it to touch the directory SPEC.md lives in).

## The brief must contain

- **Divergence statements, not pointers.** "The obvious answer here
  is X; this project does Y; because Z." Never bare "follow our
  rules" — a pointer is exactly what a familiar-pattern fallback
  reads past.
- **Enumerated choices** wherever the agent must not invent: legal
  values listed, not described.
- **The design contract verbatim** for anything user-facing (labels,
  copy, states, hierarchy) — agent discretion is implementation only.
- **Objective gates**: what "done" is, as checkable predicates
  (commands to run, files that must exist, a PR number that must
  resolve via `gh pr view <n> --json number,state`).
- **The operational block** (from `divergences.md` § Operations):
  worktree scope, e2e slot rule, poll-in-place, docs-repo handling,
  the never-list.
- **Report shape**: the exact fields the report must carry, so a
  stopped agent's last message is a deliverable, not a status.

## Tier calibration

- **Sonnet builder**: everything above, in full. Assume no inference
  beyond the written word; ambiguity becomes the familiar pattern.
- **Haiku explorer**: read-only tasks only; state the question, the
  places to look, and the answer format. No build steps.
- **Any tier**: a design question surfacing mid-build gets REPORTED,
  never decided by the agent — say so explicitly.

## After the dispatch closes

Record in the goal file (or the wave note) whether any brief
constraint proved wrong, and which — 0192's acceptance is measured on
this, not on the brief feeling thorough.
