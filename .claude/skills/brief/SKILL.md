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
   product-model/testing-harness divergence whose area the task
   touches — as written, not paraphrased. If the task exposes a
   divergence not yet on the list, ADD it to `divergences.md` in the
   same change. Skip § Operations: that block now lives in
   `.claude/agents/builder.md`'s body (loaded only when the builder
   runs), not copied into the brief.
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
- **Report shape**: the exact fields the report must carry, including
  Review, so a stopped agent's last message is a deliverable, not a
  status. This is the one piece of the old operational block that
  still belongs in the brief, not the agent definition — it differs
  per brief.
- **Adoption named**: the brief quotes the goal file's chosen
  library/framework, version, and entry-point API, or the recorded
  search that found none. Missing → stop, run the `research` agent
  first, do not dispatch.
- **Model**: Sonnet unless the brief carries a one-sentence Opus
  justification; never Fable; at most one Opus builder live.
- **Sized to ≤3 contract items.** A fourth item is the next slice, not
  a fourth bullet in this one — a 4+ item brief is the size class that
  hit the turn cap with zero commits (goal 0414 S4); the three-item
  briefs landed in one run.

## Dispatch shape

The dispatch itself is short: `Agent({subagent_type: "builder", prompt:
"brief: <path to the brief file>. goal: <path to the goal file>. <the
one or two facts that differ this time — branch name, PR title, an
amendment>."})`. The worktree scope, poll-in-place rule, docs-repo
handling, the never-list, the pre-PR reviewer dispatch and the
own-the-PR-to-merge procedure all live in `.claude/agents/builder.md`
already — never repeat them in the dispatch prompt or the brief body.

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
