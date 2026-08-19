---
name: mill-dev
description: Build and modify Mill itself (Go + Wails3 + React/TypeScript). Use when implementing features, fixing bugs, or reviewing changes in the Mill repository — it carries the working method, the enforced rules, and the step-type checklist.
---

# Developing Mill

This skill points at the enforced sources rather than duplicating
them — the repository's own gates make them the truth.

## Read these first, in order

1. `CLAUDE.md` — the working method (Research → Plan → Implement;
   Research → Adopt → Compose: never hand-roll what a vetted library
   owns), model economics, the goal backlog discipline.
2. `.claude/rules/architecture.md` — the reuse boundary, the
   core-vs-composition test (new capability = node/trigger/
   connector/Configure entity unless it's a true kernel change),
   Configure-vs-node-local config, the 500-line file cap, the
   multi-purpose-surface rule.
3. `.claude/rules/backend.md`, `frontend.md`, `testing.md`,
   `ux-writing.md`, `comments.md`, `node-standard.md`,
   `delivery-discipline.md` — each loads by scope; all are
   commit-gated.
4. `docs/SPEC.md` (private submodule) — product decisions and
   status; consult before design choices, update in the same change.

## The rhythm

- Every non-trivial change: research precedent first, state the plan,
  then implement in small verified steps.
- Local gates run on every commit via lefthook (lint, vet, race
  tests, vitest, e2e-affecting checks, copy/comment hygiene, file
  length, layout). Never bypass them; a red gate is the work.
- Delivery: short-lived branch → one PR per goal → auto-merge on
  green. `main` is ruleset-protected; direct pushes are blocked.
- Every capability ships with a seeded example proving it end to end,
  plus tests at the right layer (`.claude/rules/testing.md`'s
  layering). Changing a seed's content bumps its `SeedRevision` and
  regenerates `seed_fingerprints.json` (test-print procedure).
- A bug reproduced live becomes a committed test in the same change.

## Adding a step type (the most common extension)

Follow `.claude/rules/node-standard.md`'s checklist — 10 items,
most machine-checked by `TestNodeTypes`: typed self-documenting
config fields, explicit `Effect`, explicit `Complexity`, typed
`Consumes`/`Produces` (ADR-0042), user-copy-only descriptions (no
internal citations), kind-prefixed ID, error strings prefixed
`"node-id: %w"`, injected seams for side effects
(`composition.SetX` wired from `main.go`), a seeded example, and a
palette-group entry (`frontend/src/shared/paletteGroups.ts`).
Regenerate the contract (`go generate ./internal/contract`), the
docs reference (`go generate ./internal/docsgen`), and bindings
(`wails3 generate bindings -clean=true -ts -i` from the repo root);
bump the palette census in e2e.

## Hard constraints (never trade away)

Single binary; no Rust; no phone-home or AI API calls from Mill
itself; guardrails gate every external effect; secrets only in the
OS keychain; `docs/SPEC.md` and the goal backlog updated with the
work, not after it.
