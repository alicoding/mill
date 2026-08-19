# Delivery discipline — Definition of Ready / Definition of Done

No `paths` frontmatter — applies to every goal, every language. Terms
are Scrum's (the 2020 Scrum Guide formalized DoD as an artifact
commitment) and Kanban's (Kanban University's own "ready for delivery"
pull criteria) — adopted as the converged NAMES for gates this repo
already runs, consolidated here from CLAUDE.md/testing.md/ADR-0034 so
an agent checks ONE list, not four documents (researched 2026-08-12;
owner-mandated: "DoR should be industry standard").

## Definition of Ready — before a BACKLOG.md item enters a session
- Precedent checked, not assumed (CLAUDE.md Research→Plan→Implement).
- A capability map exists for any schema/adopt-vs-build call with more
  than one real future use (CLAUDE.md Plan step, SPEC §3.3's worked
  example).
- A goal file exists: Goal/Plan/**Acceptance stated as a checkable
  predicate**, not a vibe.
- No SPEC.md `OPEN` dependency is silently resolved by starting —
  surface the choice, or name it an explicit blocker and don't start.
- No estimate/story-point step — deliberately excluded: estimation
  negotiates shared *team* capacity, which a solo-owner +
  agent-execution loop doesn't have.

## Definition of Ready, part 2 — the integration-surfaces triage

Owner-mandated (2026-08-16, after a day of live retrofits proved the
gap: ⌘↑, ⌘-click, context menus, and palette scoping all arrived as
catches on shipped features rather than with them). Before a
capability's goal starts, answer EVERY line below explicitly in the
goal file — "wired", "deliberately not, because …", or "follow-up
goal NNNN" — never silence:

1. **Configure** — does it introduce a "which external thing" value
   (credential/endpoint/model/list)? → Configure entity + RefKind
   (architecture.md's business-vs-integration test).
2. **Workflows** — is it composition-shaped (ADR-0035: node/trigger/
   connector)? → arrives as composition with a seeded example.
3. **Atlas** — does it produce or reference knowledge a card should
   point at (a new artifact type, a mirrorable output)?
4. **Settings** — does it need an app-level preference? (Kernel
   config only — a Settings toggle never implements a side effect.)
5. **Keyboard shortcut** — is there a repeated action deserving a
   command-registry entry (surface-scoped via `surface` when it
   isn't global)?
6. **Quick access** — palette entry (via the same command) and, for
   away-from-app entry points, a Quick Panel row.
7. **Context menu** — does it render as a right-clickable object? →
   ContextMenuItem items, sharing commandIds so menu/palette/
   keyboard stay one source.
8. **Contract/MCP** — does an agent need to see or drive it?
9. **Mobile posture** — usable (or deliberately read-only) at the
   companion breakpoints and 44px targets?
10. **Data stewardship** — does it write user data? → covered by
    export/backup/import paths.

The triage is a DoR gate, not a build mandate: most answers are one
honest sentence. Retroactive coverage of already-shipped
capabilities is goal 0076's audit, not ad-hoc.

## Definition of Done — before the checkbox flips and the file moves to archive/
- Local lefthook suite green, never bypassed.
- CI's `ci-gate` required check green on the **merged** PR (ADR-0034).
- Every new capability carries a seeded example + a proof at the right
  layer (testing.md's layering) — the seed is part of DoD, never a
  follow-up.
- Any bug fixed via live/manual repro is now a committed test
  (testing.md).
- SPEC.md updated in the same change, for anything that shifts what it
  describes (mechanical-only changes exempted).
- User-visible capability or behavior change ⇒ the matching
  `userdocs/` section updated in the same change (goal 0125's docs
  DoD — same teeth as the SPEC line above); registry-derived pages
  regenerate via `go generate ./internal/docsgen` (CI-enforced
  freshness).
- The goal file's own Acceptance criteria checked against what
  SHIPPED, not what was planned.
- Nothing secret-shaped staged; a real commit message.

## Session conduct (adopted from primary-sourced practice, 2026-08-17 research pass)
- **Reviewer findings get triaged, not chased**: a reviewer prompted
  to find gaps will report some even when the work is sound —
  act only on findings that affect correctness or stated
  requirements; the rest is recorded or dropped, never
  auto-implemented (over-engineering via review is a named failure
  mode in the tool's own docs).
- **Post-merge worktree verification is a CHECKED step**: after an
  agent branch merges, confirm the worktree is actually removed
  (`git worktree list`) and HEAD sits on the intended branch — the
  tool's worktree cleanup has a confirmed upstream defect class
  (stale worktrees survive sessions; a leftover checkout makes a
  later merge silently no-op "Already up to date" against the wrong
  ref). Silent by design; verify, don't assume.
- **Two named session failure patterns** (tool-docs-primary): the
  kitchen-sink session (unrelated tasks sharing one context — split
  them) and correcting the same thing twice (the third attempt is a
  restart-with-a-better-brief, not another correction).
- **Long arcs write state to files, not context**: compaction is
  lossy by the tool's own docs — in-session progress that must
  survive belongs in the goal file / a plan file at every
  significant checkpoint, so a compaction or restart resumes from
  disk, not from what the summary preserved.

## Build-health visibility
The ruleset (ADR-0034) already makes main unmergeable-red; confirm,
don't re-enforce:
- `gh pr checks <n> --watch` right after opening a goal's PR.
- `gh run list -b main -L 1` once, when picking up the next goal.
No richer signal is worth building — a webhook receiver is a second
deployable, already forbidden (SPEC §1.1).

## Tech debt
A BACKLOG.md entry with the same DoR/DoD as any goal — never a second
register, never a bare TODO as the record (a comment may point at a
goal/ADR id, never stand alone).

## Deferrals need a home (goal 0128)
A deferral is only legal when the SAME sentence names its tracking
home: a goal number, a BACKLOG line, a SPEC `OPEN` item, or an
explicit revisit trigger ("revisit when X"). "Out of scope" / "not
built" / "future work" standing alone is a forgotten request in the
making — the 2026-08-19 audit found 133 of them. Review-checked like
comments.md's provenance rule, not grep-gated (deferral phrasing is
unbounded). Goal files carry a "Deferred from this goal" section when
anything in-scope was narrowed — the home exists by construction, and
the register (docs/goals/0128-deferred-register.md, then BACKLOG
entries it spawns) is part of RELEASING.md's docs review.
