# 0019 — "Which build am I looking at, and is it live?" clarity

## Problem (2026-08-10, live testing)
Across a whole session the owner repeatedly could not tell whether the
window in front of them was the current build: mistook the stale
`/Applications/Mill.app` (@004e039) for current, saw the old
staleness badge trip on a docs/Taskfile commit and not clear, and asked
directly twice for "a way to make sure we are always on the most
up-to-date one."

Root cause: the build-identity badge only compared the **frontend
bundle commit vs the Go binary commit** (internal consistency). So a
matching INSTALLED `.app` rendered *nothing at all* — no identity — and
could masquerade as the live build. Comparing against live git HEAD
instead would be worse: it false-alarms on every docs/tooling commit
(the annoyance the owner already hit).

## Decision — self-identify the artifact; dev = live by construction
One rule for the owner: **green `DEV · live` = trust this window;
anything else = not the live build.** (App.tsx badge block.)
- `task dev` (`import.meta.env.DEV`, vite serve): frontend is Vite-HMR-
  live, Go auto-rebuilds on save → up to date BY CONSTRUCTION. Green
  `DEV · live`. No hash, no HEAD comparison, no false "behind" alarm.
- Installed `.app` (native webview, production bundle): neutral
  `INSTALLED · <commit>`, ALWAYS shown, so it can't be mistaken for live.
- Server mode: `SERVER · <commit>`.
- Red `STALE BUILD` stays only for the genuine orphaned-window case
  (bundle commit ≠ binary commit — SPEC §3.8).

Paired with the Taskfile DX fix (`4243b6b`): `task dev` no longer wipes
`bin/`, and the loop is documented (start once, leave running, frontend
edits are instant HMR).

## Status
Built 2026-08-10 (this pass), frontend-only. SPEC §3.8's build-identity
badge entry updated in the same change.

## Acceptance
Owner glances at any window and knows in one read whether it's the live
dev build or a non-live artifact, with zero false alarms on doc/tooling
commits.
