# 0009 — E2e parallelism via per-worker isolation

## Goal
The Playwright suite runs `workers: 1` — fully serial (~10 min for
~109 tests), because all tests share one webServer + one settings file
(`/tmp/mill-e2e-settings.json`). That single decision also causes the
two other standing costs: the run-the-suite-twice cleanup discipline
(state persists across runs, so leaks only surface on run 2) and
cross-run contamination (hit for real 2026-08-10: a broken-click bug
in run 1 left undeleted fixtures that produced 41 spurious strict-mode
failures in run 2). Owner asked directly whether we're "lacking
Playwright best practices" — yes: Playwright's core guidance is
parallel workers with isolated state.

## Plan
1. [ ] Per-worker server fixture: each worker spawns its own
   `bin/mill-server` on a worker-indexed port with its own
   `MILL_SETTINGS_PATH`/`MILL_EXECUTION_DB_PATH` (the env seams exist;
   the e2e isolation guard already proves the pattern). One binary
   build shared across workers (build once in globalSetup, spawn N).
2. [ ] `workers: 4` (tune against the machine), `fullyParallel` per
   file where safe.
3. [ ] Retire the double-run discipline from .claude/rules/testing.md:
   replace with (a) per-test unique fixture names + explicit
   post-delete assertions, and (b) ONE dedicated persistence spec that
   deliberately reuses a settings file across two in-spec server
   restarts — keeping the realism where it's load-bearing.
4. [ ] Expected outcome: suite ~2-3 min, single run sufficient, agent
   verification briefs get dramatically cheaper (the owner's
   token-budget concern — this is the biggest structural lever).

## Acceptance
Full suite green in under ~4 min on the dev machine with parallel
workers; a deliberately-leaked fixture is caught by the new explicit
assertions in a single run; testing.md updated; agent briefs reference
single-run verification.
