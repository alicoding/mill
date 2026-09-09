# Delivery discipline — Definition of Ready / Definition of Done

No `paths` frontmatter — every goal, every language.

## Definition of Ready — before a BACKLOG.md item enters a session
- Goal file carries three Research headings before Plan: **Precedent**
  (best-in-class tools, real search), **Today** (what Mill does now,
  read/probed), **Gap** (the delta Plan answers). No Gap ⇒ not Ready.
- **Adoption named before dispatch.** Precedent also names the library,
  framework or package that already solves it: a real search, primary
  source linked, version pinned, entry-point API named — or the
  search finding none. No brief goes out without it.
- A capability map for any schema/adopt-vs-build call with >1 real
  future use (SPEC §3.3).
- A goal file: Goal/Plan/**Acceptance as a checkable predicate**.
- Frontmatter header (`id`, `status`, `date`, `prs [..]`, `proof [..]`,
  `spec_refs [..]`) — delivery-evidence-ledger data.
- Bug-shaped goals also carry `defect_class: <kebab-slug>` — ONE axis.
  Grep `defect_class` across `goals/`. **Two strikes make the goal
  about the CLASS.**
- **One strike makes a class.** A CI/review finding is fixed as its
  CLASS in the same PR — the gate/rule plus a sweep of instances —
  or carries the number of a goal filed the same day.
- No SPEC.md `OPEN` dependency silently resolved by starting.

## Definition of Ready, part 2 — the integration-surfaces triage
Before a capability's goal starts, answer every line: wired,
deliberately-not-because, or follow-up goal NNNN:
1. **Configure** — a "which external thing" value? → entity + RefKind.
2. **Workflows** — composition-shaped? → composition + seed.
3. **Atlas** — knowledge a card should point at?
4. **Settings** — an app-level preference?
5. **Keyboard shortcut** — a command-registry entry?
6. **Quick access** — palette entry + Quick Panel row?
7. **Context menu** — ContextMenuItem sharing commandIds?
8. **Contract/MCP** — does an agent need to see/drive it?
9. **Mobile posture** — usable/read-only at companion breakpoints?
10. **Data stewardship** — covered by export/backup/import?
11. **Interaction primitives** — event primitives per transition;
    focus/blur justified.
12. **Command registry** — a registered command, honest `enabled()`.
13. **Platform vs extension** — PLATFORM when ≥2 extensions would
    re-implement it, touching the content
    plane/guardrails/secrets/identity/chrome, or a converged contract
    owns it declaratively; EXTENSION otherwise. Orchestrator decides;
    an undecided case stops it.

## Definition of Done — before archive/
- Local lefthook suite green, never bypassed.
- CI's `ci-gate` green on the **merged** PR (ADR-0034).
- **Warning-free and current.** Zero warnings in every gate's output,
  fixed same-PR. Toolchain components (Go, Node, Wails, Playwright,
  CLT/SDK, Actions) stay within one minor/beta of latest, else a
  same-day BACKLOG item (deps-dont-linger).
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
- Reviewer findings triaged: act only on correctness/requirements gaps.
- Post-merge worktree state: CHECKED (`git worktree list`).
- Avoid: kitchen-sink sessions, correcting the same thing twice.
- Long arcs write state to files, not context, per checkpoint.
- `gh run list -b main -L 1` when picking up the next goal.

## Green baseline always
Every PR/main check must be GREEN — a permanently-red job is banned. Fix
same-day or move OUT with a register entry naming the path back.
"Non-required" is a promotion lane, never a standing exemption.

## Orchestration economics (goal 0414)
- WIP limit: ≤6 open goal PRs before a new dispatch.
- A builder owns its PR through merge; the orchestrator dispatches and
  verifies.
- Budgets are per-dispatch (`maxTurns`, token ceiling), cumulative
  across resumes at ≤2 per brief; one bounded wait per turn; closeouts
  batch per tick.
- Every finished agent's tokens append to `docs/goals/AGENT-LEDGER.md`
  (git-ignored).

## Tech debt and deferrals
A BACKLOG.md entry needs the same DoR/DoD as any goal — never a bare
TODO. A gap against researched precedent is never deferred: build it
in the finding goal; an agent that would defer it reports it. Legal
only when the same sentence names its tracking home: a goal number,
BACKLOG line, SPEC `OPEN` item, or revisit trigger.
