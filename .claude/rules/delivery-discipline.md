# Delivery discipline — Definition of Ready / Definition of Done

No `paths` frontmatter — applies to every goal, every language.

## Definition of Ready — before a BACKLOG.md item enters a session
- Goal file carries three Research headings before Plan: **Precedent**
  (best-in-class tools, real search), **Today** (what Mill does now,
  read/probed), **Gap** (the delta Plan answers). No Gap ⇒ not Ready.
- **Adoption named before dispatch.** Precedent also names the library,
  framework or package that already solves it: a real search, primary
  source linked, version pinned, entry-point API named — or the search
  that found none. No coding brief goes out without it.
- A capability map for any schema/adopt-vs-build call with >1 real
  future use (SPEC §3.3).
- A goal file: Goal/Plan/**Acceptance as a checkable predicate**.
- Frontmatter header (`id`, `status`, `date`, `prs [..]`, `proof [..]`,
  `spec_refs [..]`) — source data for the delivery-evidence ledger.
- Bug-shaped goals also carry `defect_class: <kebab-slug>` — ONE axis.
  Grep `defect_class` across `goals/` first. **Two strikes: second
  occurrence makes the goal about the CLASS.**
- **One strike makes a class.** A CI/review finding is fixed as its
  CLASS in the same PR — the gate/rule plus a sweep of existing
  instances — or carries the number of a goal filed the same day.
- No SPEC.md `OPEN` dependency silently resolved by starting.

## Definition of Ready, part 2 — the integration-surfaces triage
Before a capability's goal starts, answer EVERY line — "wired",
"deliberately not, because …", or "follow-up goal NNNN":
1. **Configure** — a "which external thing" value? → entity + RefKind.
2. **Workflows** — composition-shaped? → composition + seed.
3. **Atlas** — knowledge a card should point at?
4. **Settings** — an app-level preference?
5. **Keyboard shortcut** — a command-registry entry?
6. **Quick access** — palette entry + Quick Panel row?
7. **Context menu** — ContextMenuItem sharing commandIds?
8. **Contract/MCP** — does an agent need to see or drive it?
9. **Mobile posture** — usable/read-only at companion breakpoints?
10. **Data stewardship** — covered by export/backup/import?
11. **Interaction primitives** — event primitives per transition; focus/
    blur transitions justified.
12. **Command registry** — a registered command with honest `enabled()`.
13. **Platform vs extension** — PLATFORM when ≥2 extensions would
    re-implement it, it touches the content plane/guardrails/secrets/
    identity/chrome, or a converged contract owns it declaratively;
    EXTENSION otherwise. Orchestrator decides; an agent meeting an
    undecided case stops.

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
- Post-merge worktree verification is CHECKED (`git worktree list`).
- Avoid: kitchen-sink sessions, and correcting the same thing twice.
- Long arcs write state to files, not context, at every checkpoint.
- `gh run list -b main -L 1` when picking up the next goal.

## Green baseline always
Every PR/main check must be GREEN — a permanently-red job is banned. Fix
same-day or move OUT of the baseline with a register entry naming its
path back. "Non-required" is a promotion lane, never a standing
exemption.

## Orchestration economics (goal 0414)
- WIP limit: ≤6 open goal PRs before a new build dispatch.
- A builder owns its PR through merge; the orchestrator only
  dispatches and verifies.
- Budgets are per-dispatch (`maxTurns`, a token ceiling); one bounded
  wait per turn, never wait-only; closeouts batch per tick.
- Every finished agent's tokens append to `docs/goals/AGENT-LEDGER.md`
  (git-ignored).

## Tech debt and deferrals
A BACKLOG.md entry needs the same DoR/DoD as any goal — never a bare
TODO. A gap against researched precedent is never deferred — build it
in the finding goal; an agent that would defer it reports it instead.
Legal only when the same sentence names its tracking home: a goal
number, BACKLOG line, SPEC `OPEN` item, or revisit trigger.
