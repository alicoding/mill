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
