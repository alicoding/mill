# Delivery discipline — Definition of Ready / Definition of Done

No `paths` frontmatter — every goal, every language.

## Definition of Ready — before a BACKLOG.md item enters a session
- Before Plan, Goal Research has **Precedent** (best-in-class tools, real search),
  **Today** (Mill read/probed), and **Gap** (Plan's delta). No Gap ⇒ not Ready.
- **Adoption named before dispatch.** Before Plan, name the maintained solution,
  pinned version and highest-level API from a linked primary source. Record its
  full capability/upstream comparison, actual constraint mismatch if rejected,
  and Mill-specific adapter/domain remainder. “Not researched” is not “none
  found”; unresolved fit is not Ready.
- A capability map for any schema/adopt-vs-build call with >1
  future use (SPEC §3.3).
- A goal file with Goal/Plan/**checkable Acceptance**.
- Frontmatter (`id`, `status`, `date`, `prs [..]`, `proof [..]`,
  `spec_refs [..]`) for the delivery-evidence ledger.
- Bug goals carry one-axis `defect_class: <kebab-slug>`. Grep it across
  `goals/`. **Two strikes make the goal about the CLASS.**
- **One strike makes a class.** Fix a CI/review finding as its CLASS
  in the same PR — gate/rule plus instance sweep — or file a same-day goal.
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
- Dispatch budgets (`maxTurns`, tokens) are cumulative across ≤2 resumes;
  one bounded wait/turn; closeouts batch per tick.
- Append every finished agent's tokens to the git-ignored
  `docs/goals/AGENT-LEDGER.md`.
- A brief carries ≤3 contract items; a 4th is the next slice.
- The queue has Product and Platform lanes. Platform (`0PL-`) holds health
  breaches, technical debt and toolchain currency. When both lanes have
  Ready work, dispatch one Ready Platform item per two Ready Product items;
  escalated `platform-health` issues lead Platform. Allocation never expands
  a bounded user task's authorized scope.

## Tech debt and deferrals
Every BACKLOG.md entry needs goal-level DoR/DoD, never a bare TODO.
Build researched-precedent gaps in the finding goal; agents report
attempted deferral. A legal deferral's sentence names its goal, BACKLOG
line, SPEC `OPEN` item, or revisit trigger.
