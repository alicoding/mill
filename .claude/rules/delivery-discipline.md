# Delivery discipline — Definition of Ready / Definition of Done

No `paths` frontmatter — applies to every goal, every language.

## Definition of Ready — before a BACKLOG.md item enters a session
- Goal file carries three Research headings before Plan: **Precedent**
  (best-in-class tools, real search), **Today** (what Mill does now,
  read/probed), **Gap** (the delta Plan answers). No Gap ⇒ not Ready.
- A capability map for any schema/adopt-vs-build call with more than
  one real future use (SPEC §3.3).
- A goal file: Goal/Plan/**Acceptance as a checkable predicate**.
- Frontmatter header (`id`, `status`, `date`, `prs [..]`, `proof [..]`,
  `spec_refs [..]`) — source data for the delivery-evidence ledger
  (`docs/goals/0164-delivery-evidence-ledger.md`).
- Bug-shaped goals also carry `defect_class: <kebab-slug>` — ONE axis.
  Grep `defect_class` across `goals/` before coining a new slug. **Two
  strikes: second occurrence makes the goal about the CLASS.** Older
  archived goals without the field are classified lazily, when a grep
  for a new bug surfaces them — never by bulk archaeology.
- No SPEC.md `OPEN` dependency silently resolved by starting.
- No estimate/story-point step.

## Definition of Ready, part 2 — the integration-surfaces triage
Before a capability's goal starts, answer EVERY line in the goal file —
"wired", "deliberately not, because …", or "follow-up goal NNNN":
1. **Configure** — a "which external thing" value? → entity + RefKind.
2. **Workflows** — composition-shaped (ADR-0035)? → composition + seed.
3. **Atlas** — knowledge a card should point at?
4. **Settings** — an app-level preference (kernel config only)?
5. **Keyboard shortcut** — a command-registry entry?
6. **Quick access** — palette entry + Quick Panel row?
7. **Context menu** — ContextMenuItem sharing commandIds?
8. **Contract/MCP** — does an agent need to see or drive it?
9. **Mobile posture** — usable/read-only at companion breakpoints?
10. **Data stewardship** — covered by export/backup/import?
11. **Interaction primitives** — event primitives per transition; focus/
    blur transitions justified.
12. **Command registry** — a registered command with honest `enabled()`.

## Definition of Done — before archive/
- Local lefthook suite green, never bypassed.
- CI's `ci-gate` green on the **merged** PR (ADR-0034).
- New capability: seeded example + proof at the right layer, same
  change.
- Bug fixed via live/manual repro is now a committed test.
- SPEC.md updated same change (mechanical-only exempted).
- User-visible change ⇒ matching `userdocs/` updated;
  `go generate ./internal/docsgen`.
- Goal's Acceptance checked against what SHIPPED.
- Nothing secret-shaped staged; a real commit message.
- BACKLOG.md line matches reality: checked, archive/ link, no stale
  status.

## Session conduct
- Reviewer findings triaged, not chased: act only on correctness/
  requirements gaps.
- Post-merge worktree verification is CHECKED (`git worktree list`,
  HEAD on the right branch).
- Avoid: kitchen-sink sessions, and correcting the same thing twice
  (third attempt is a restart-with-a-better-brief).
- Long arcs write state to files, not context, at every checkpoint.

## Green baseline always
Every PR/main check must be GREEN — a permanently-red job is banned. Fix
same-day or move OUT of the baseline with a register entry naming its
path back. "Non-required" is a promotion lane, never a standing
exemption.

## Build-health visibility
- `gh pr checks <n> --watch` after opening a PR; `gh run list -b main
  -L 1` when picking up the next goal.

## Tech debt
A BACKLOG.md entry with the same DoR/DoD as any goal — never a bare
TODO (a comment may point at a goal/ADR id, never stand alone).

## Deferrals need a home (goal 0128)
A gap between a researched precedent and what Mill has today is NOT
deferrable — build it in the goal that found it; an agent that would
defer it reports it instead, including gaps found by any review. A
deferral is legal only when the same sentence names its tracking home:
a goal number, BACKLOG line, SPEC `OPEN` item, or revisit trigger —
never standing alone. Goal files carry a "Deferred from this goal"
section when scope was narrowed, feeding
`docs/goals/archive/0128-deferred-register.md`.
