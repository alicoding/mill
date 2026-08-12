# ADR-0034 — Git/CI operating model: trunk-based, PR-per-goal, ruleset-gated main

Status: accepted (owner-ratified 2026-08-11, "full go" on the researched
recommendation).

## Context

CI (ADR-0002, `.github/workflows/ci.yml`) existed but was dormant: main
went unpushed for 273 commits over 5 days, so the cloud pipeline gated
nothing. The owner asked for researched precedent before resuming,
naming a specific past failure: AI-agent projects where branch/PR
sprawl grew until "we ended up always ignoring the pipeline."

The research pass found that failure ON RECORD in this repo's own
history: of the last 11 Actions runs (2026-08-06), 5 were cancelled and
3 failed — rapid direct pushes to main were outrunning a suite that
took up to 43 minutes, `cancel-in-progress: true` killing each previous
run, so the signal never meant anything; pushing then stopped entirely.
The ignored pipeline was a mechanism, not a mood.

Load-bearing mechanical finding (GitHub's own docs + community
confirmation): **required status checks cannot gate a direct push** — a
check must already have passed on that exact SHA before the ref update
is allowed, and GitHub never runs checks synchronously at push time. A
never-seen SHA pushed directly at a check-protected branch is rejected
as "no status". So "main never receives an un-CI'd commit" is only
expressible through a branch/PR-shaped flow; there is no
direct-push-with-checks configuration to prefer instead.

## Decision

- **Local discipline unchanged**: commit every verified change to the
  working branch, gated by lefthook's full local mirror (CLAUDE.md's
  standing rule). Trunk-based development's own guidance for
  very-small teams, already in effect.
- **`main` is protected by a GitHub Ruleset** (not classic branch
  protection — legacy per GitHub's own docs): restrict deletions, block
  force pushes, require a pull request, require the CI status checks,
  with the owner on the bypass list as **"for pull requests only"** —
  direct pushes are blocked even for the owner, but a green PR
  self-merges with no reviewer requirement (there is no second person).
- **One PR per delivered goal** (`docs/goals/BACKLOG.md`'s own delivery
  unit): the PR is the CI gate plus a durable, skimmable change
  artifact, and feeds `release.yml`'s `--generate-notes`. Never
  PR-per-commit (ceremony), never omnibus.
- **Push cadence: at least once per completed goal, ideally per
  session** — an unpushed batch is a bisect-blind spot (a multi-commit
  push produces ONE workflow run, on the head commit only; CI never
  evaluates the intermediate SHAs). No tool enforces cadence; the
  ruleset removes direct-push as the path of least resistance, and
  CLAUDE.md records the habit.
- **Worktree branches stay short-lived** (Anthropic's own worktree
  lifecycle: branch → PR/merge → remote branch deleted → worktree
  recycled), never a second long-lived line of history.
- **Secret-scanning push protection enabled before the catch-up push**
  (free on public repos; blocks recognized secret patterns before they
  reach the remote) — the catch-up carries 273 commits of history never
  passed through that net, plus a local heuristic sweep of the unpushed
  range first.
- **Catch-up sequencing**: one final direct push of main (CI runs on
  its head), THEN the ruleset activates — so the gate never has to
  block the push that establishes it.

## Rejected / deferred

- **Merge queue**: GitHub's own positioning is concurrent-merger teams;
  one human merging one PR at a time has no queue to manage.
- **CI path filtering** (skip the heavy matrix for docs-only changes) —
  deliberately DEFERRED, not adopted with the rest: `paths`-filtered
  workflows report no status at all for skipped runs, which makes
  required checks hang at "Expected" and block the PR forever — a
  documented footgun whose workarounds (no-op twin workflows,
  job-level change detection) add real complexity. Mill's same-change
  rule (docs ride with the code that motivates them) makes docs-only
  PRs rare, so the savings are small today. Revisit if PR wall-clock
  cost becomes a felt problem; the cancellation cascade this was meant
  to help with is already structurally fixed by per-ref concurrency
  plus the PR flow.
- **Force-push/history rewrites**: unchanged — CLAUDE.md's existing
  "never without being explicitly asked" rule; now also enforced
  server-side by the ruleset.

## Consequences

- Agent sessions targeting a goal work on a short-lived branch (or
  worktree) and end by opening/merging the goal's PR once CI is green;
  quick fixes outside a goal ride the next goal PR or a small
  dedicated one.
- CI must stay green-and-trusted to stay authoritative
  (trunkbaseddevelopment.com: a red-often build "is of greatly reduced
  value") — a persistently red or flaky job is a defect to fix, never
  to rerun-until-green.
- The ruleset's live rejection behavior gets one manual dry-run
  verification (attempt a direct push after activation) rather than
  being trusted from docs alone.

## Update (2026-08-11) — adopted budgets, and path filtering un-deferred

Goal 0024's target-architecture pass (`.github/workflows/ci.yml`)
closes out the two items this ADR originally left open: no timing
budget was ever stated, and path filtering was explicitly deferred.
Both are resolved now, the second one reversed.

- **Adopted budgets, per DORA's own elite-performer guidance (a ≤10-
  minute build/test cycle) rather than an invented number**: **≤7
  minutes is the target**, **10 minutes is the hard ceiling** a job is
  allowed to approach before it's treated as a defect, not a fluke.
  Per-job `timeout-minutes` in `ci.yml` are set to roughly **3× each
  job's measured baseline** — generous enough that a legitimate slow
  run doesn't get killed mid-flight (a timeout is a circuit breaker
  against a genuinely hung job — an infinite loop, a wedged process
  spawn — not a budget-enforcement mechanism; the ≤7min/10min figures
  above are the actual budget, watched by a human reading run
  duration, not by the timeout itself): `changes` 5, `file-loc-limit`
  5, `rules-frontmatter` 5, `root-file-naming` 5, `frontend` 10,
  `lint-go` 10, `build-go` (macOS leg) 15 / (Linux leg) 10, `test-go`
  10, each `e2e` shard 15, `govulncheck` 15, `dependency-review` 5,
  `ci-gate` 5.
- **3-consecutive-breach escalation rule**: a job breaching the
  10-minute ceiling on 3 consecutive runs (not one — a single slow run
  can be real-world noise: a cold GitHub Actions cache, a slow
  upstream package-registry pull) is treated as a genuine regression
  needing investigation (a new heavy dependency, an accidentally
  serialized step, real contention), not a number to quietly raise.
  Raising the timeout instead of investigating is exactly the
  rerun-until-green failure mode this ADR's own Consequences section
  already rejects, one level down.
- **Retry-quarantine policy**: Mill does not use blanket step-level
  retries to paper over flakiness (no `retry:`/`continue-on-error`
  used as a flake mask anywhere in `ci.yml`) — `.claude/rules/
  testing.md`'s existing discipline already governs this
  (`playwright.config.ts`'s one `retries: 1` is scoped, documented,
  and justified by a named, understood timing flake, not a blanket
  policy). A job that becomes reliably flaky gets quarantined
  explicitly (an owner-visible, named `continue-on-error` with a
  comment stating why and a follow-up to fix it, the same treatment
  `govulncheck` already gets for a different, legitimate reason — an
  external tool's own experimental status) rather than silently
  retried until it passes. No new mechanism needed; this section
  exists to make the policy explicit rather than assumed.
- **CI path filtering — un-deferred, adopted.** The original deferral
  reasoning (`paths`-filtered workflows report no status at all for a
  skipped run, hanging a required check at "Expected" forever) is
  still correct about workflow-level `on.pull_request.paths` — that
  mechanism is still not used anywhere in `ci.yml`. What changed is
  the *mechanism*: a new first job, `changes` (`dorny/paths-filter`,
  SHA-pinned), computes whether the PR's diff is entirely
  docs/**/*.md/.claude/**/LICENSE, and every other job (except
  `govulncheck`, left as a `frontend`-cascaded no-op) gets
  `if: success() && needs.changes.outputs.code == 'true'`. This is a
  **job-level** conditional, not a workflow-level path filter — the
  job still runs the GitHub Actions scheduler's own bookkeeping and
  **reports a real status** (`skipped`, which GitHub's required-checks
  mechanism treats as a pass), it just no-ops its steps. A skipped job
  can never hang a required check at "Expected" the way an
  entirely-non-triggered workflow run can — that failure mode was
  specific to `on.paths`, not to conditional execution in general, and
  doesn't reappear here. `ci-gate` (the new aggregator, also un-defers
  the "which jobs does the ruleset actually require" question — see
  goal 0024 item 4) explicitly treats a `skipped` upstream result as a
  pass, matching this. The original "docs-only PRs are rare under
  Mill's same-change rule, so the savings are small" observation still
  holds as *why this wasn't urgent*, not as a reason it's wrong to
  build now that the mechanism is understood and the felt cost (a
  15-minute-plus e2e matrix run on a pure `docs/goals/*.md` edit) is
  real.
- **`e2e` job's shard matrix gained `fail-fast: false`** (goal 0026),
  after a real incident (PR 11, run 31557343422): shard 3 failed
  legitimately, and GitHub Actions' own fail-fast default immediately
  cancelled shards 1 and 2 mid-run rather than letting them report
  their own verdicts — signal lost, not just noise, the same class of
  problem `build-go`'s own 2-platform matrix already carried this flag
  for.
