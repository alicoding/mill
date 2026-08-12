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
- The goal file's own Acceptance criteria checked against what
  SHIPPED, not what was planned.
- Nothing secret-shaped staged; a real commit message.

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
