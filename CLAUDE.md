# Mill

Wails3 desktop app: Go backend + React/TypeScript/Vite frontend, compiled to a single
binary; will become a guardrailed agentic-workflow/automation tool. Full context lives in
`docs/SPEC.md` — read the relevant sections before any design decision, and update it as
decisions land; this file isn't a substitute (backtick-pointed, not `@`-imported, since
`@`-import eagerly loads the whole file every session — SPEC §9.1).

**Standing-context budget** (goal 0325): this file ≤200 lines, the unconditional
`.claude/rules/*.md` files (no `paths:` key) ≤3,000 words total, enforced by
`scripts/check-standing-context.sh`. History and precedent for this and the orchestration
model below: ADR-0050.

## The orchestrator decides the app; agents execute the decided design; the orchestrator verifies

1. **The orchestrator's own work is reasoning**: research verdicts, decisions, design
   contracts, rules and standards, briefs, verification. A design contract is COMPLETE
   before dispatch: every state, label, keystroke, transition, the touch-set, the
   objective gates. If it can't be written that completely, the decision isn't made yet
   — make it, don't code around it.
2. **Everything with a complete written design is executed by a builder agent, never by
   the orchestrator** — user-facing surfaces included. The orchestrator writes code only
   when the change is smaller than the brief that would describe it, and states why.
3. **A design question surfacing mid-build is reported, never decided by the agent**; the
   orchestrator decides and amends the brief.
4. **Verification stays the orchestrator's**: eyes on the diff, the live build probed,
   the screenshot pass. Never accept an agent's report as the evidence.
5. **Token accounting is a design constraint**: file spelunking, log reading,
   commit/rebase babysitting belong to agents (explorer, test-investigator,
   pr-shepherd), conclusion returned, not the dump.

Model picks: **Haiku** for read-only volume (`explorer`), **Sonnet** for bounded
mechanical execution from a written spec (regens, migrations, test runs, small features
with a complete contract), **Opus** for execution needing local judgment inside the
contract (multi-file UI from a design doc, a root-cause with a written procedure, a
library adoption). Every `Agent` delegation states its model explicitly; the task is
*fixed and bounded* (a written brief with objective gates, per `.claude/skills/brief`) or
the missing piece is still the orchestrator's.

**Every dispatched BUILD agent works in its own git worktree; the main checkout belongs
to the orchestrator.** State it in the brief. Before ANY git write or build in the main
checkout, check `git branch --show-current` and `git status` — if it is not main or the
tree is dirty, an agent owns it; deploy instead from a throwaway worktree at
origin/main.

**Concurrent dispatch is the default; serialization must earn its keep.**
- **Touch-sets, not turns.** Dispatch concurrently whenever the brief's predicted
  touch-sets are disjoint outside known hub files (generated `frontend/bindings/**`,
  shared Atlas chrome). Dependent slices of one arc sequence as dependencies, not policy.
- **Hub files get a merge strategy, not a mutex.** Bindings conflicts resolve by
  regenerating on rebase (`wails3 generate bindings`), never hand-merged; the
  pr-shepherd handles single-file brushes.
- **A verification lock, not a build lock.** Agents author in parallel; heavy gates
  (Playwright e2e, `go test -race`) run ONE suite at a time on this 16GB machine. Cap
  2–3 concurrent build agents; pause under ~2GB free.
- **The nested docs repo stays effectively single-writer**: it lives at one physical
  path every concurrently-running agent shares, so stage only the files you changed
  there — never `git add -A`, never `git add -f` anything under `goals/`. Commit docs
  promptly rather than leaving them uncommitted across a long build.

**Design/UX/spec contracts are the orchestrator's own work-product — never delegated.**
Before dispatching a user-facing surface, the orchestrator writes the design contract
INTO the brief: what renders where, what each click/keystroke does, every
label/empty-state's copy, what changes on each state transition. The agent's discretion
is implementation only.

## Upgrade the ground before building on it

Before a feature goal enters a session, ask what its subsystem costs to EXTEND today. If
"a lot," the upgrade goal goes in front of it in the queue — the feature arc's first
slice, not a separate initiative. Measure it (repeatable shape: goals 0163, 0169): the
files/lines the newest similar addition cost, and how many hand-maintained places had to
learn the new thing exists. Test: would the next three additions each pay this cost
again? If yes, upgrade first and prove it by migrating EXISTING items onto it (old tests
pass unmodified) before any new one. If no, build the feature directly and record why the
upgrade wasn't needed.

## Goal backlog: `docs/goals/BACKLOG.md` is the delivery queue

Requirements live in `docs/SPEC.md`; the committed, hand-reorderable priority queue lives
in `docs/goals/BACKLOG.md` (top = next; UX/frontend-first is the standing tiebreak). No
explicit goal: take the top unchecked item, read its goal file, follow Research → Plan →
Implement. Work discovered mid-session that outlives the session gets a goal file and a
queue position before the session ends.

**Mirror the active queue into the session task list**: one task per in-flight/queued
item, blocker-chained in queue order. `in_progress` — worked THIS turn, nothing else.
`pending` — queued, or blocked on the owner (subject SAYS SO). `completed` — the OUTCOME
in the subject, not the intention. BACKLOG.md stays the truth; the task list is visibility.

**Before an ad-hoc request that isn't the queue's top item, name in one sentence where it
lands against BACKLOG.md**: supersedes/reorders, merges into an existing goal, becomes a
new goal, or rides the next PR below goal-granularity — the sentence in the response IS
the record.

**With a ratified queue, sessions self-drive** — finish a goal, pull the next, continue;
never idle awaiting a go-ahead the queue already gave. Stop for the owner ONLY when: it
costs money, it's irreversible, it's a SPEC `OPEN` item, or a pure taste/product call with
no defensible precedent to research against. Never granted: force-push, history
rewrites. A delivered goal's file moves to `docs/goals/archive/` on completion. **Goal
files and BACKLOG.md are a LOCAL-ONLY record** — `docs/goals/` is git-ignored in the
nested docs repo and never committed, on this machine's disk only; everything else in
`docs/` commits as before.

**Releases are held until v1.** Beta builds publish on every merge and in-app updates work
from them, so nothing needs a tagged release yet; leave release-please's PR open and
unmerged. Revisit at v1.

## Working method: Research → Plan → Implement

1. **Research** — three parts, each its own heading in the goal file BEFORE Plan:
   - **Precedent** — the best-in-class tools people actually use (two or three, named,
     from a real search) and how each does it: interaction, labels, states, data shape.
     "Nothing exists for X" needs a real search behind it, not an assumption.
   - **Today** — what Mill does now, read from the code and probed live: the files, the
     states, "nothing" when honest.
   - **Gap** — precedent against today, line by line: what's missing, what's a forced
     pattern to converge, what already matches.
   **Research → Adopt → Compose** (`.claude/rules/architecture.md`,
   `.claude/rules/adopt-converged-patterns.md`). **A confirmed gap is built now** — in
   THIS goal, never a follow-up; no agent may defer it (only the owner may narrow it,
   in-session, recorded in the goal file). Any review finding a precedent violation gets
   the same treatment: a proper fix planned then and there.
2. **Plan** — derived from the Gap: state the approach and tradeoffs before editing
   files. A design choice with more than one defensible answer is written up and
   recorded in `docs/SPEC.md`. A schema or adopt-vs-build call with more than one real
   future use gets a capability map first (`docs/SPEC.md` §3.3).
3. **Implement** — only after 1 and 2. Small, reviewable steps.

**Commit every verified change, always.** Once a change passes the full local check
suite, commit it; never leave the tree dirty. Real commit message, no secret-shaped
staged content, never force-push, amend, or rewrite history unless explicitly asked.
(Force-push and filter-branch/filter-repo are hook-denied outright —
`scripts/hook-command-guard.sh`, which also denies `pkill -f`/`killall`.)

**Deliver through short-lived branches + a PR per goal; push at least once per session**
([ADR-0034](docs/adr/0034-git-ci-operating-model.md)). `main` is ruleset-protected: CI
checks required, a green PR self-merges. One goal = one self-merged PR; worktree/agent
branches live only as long as their one task.

A SPEC.md `OPEN` item is never silently resolved by implementing one option — surface
the choice.

**Goal-driven sessions finish their bounded scope, then hand off.** If a goal is too
large for one session, say so and ask before starting, not after ending partially done.

## Hard constraints (non-negotiable — see `docs/SPEC.md` §1.1 for the why)

Product-level, always in effect. Coding conventions live in
`.claude/rules/` instead.

- **No Rust** anywhere in the toolchain or dependency tree.
- **No AI API calls from Mill itself, no phone-home telemetry** — Mill
  mediates/guards actions other systems initiate, it is not an LLM
  client. Zero outbound calls not explicitly user-initiated via a
  user-configured connector.
- **Single binary, no separate CLI/backend split** — Wails3 satisfies this.
- **Install story is `git clone` + documented local build** — no
  hosted-service dependency for the core loop.
- **CI/CD from day one** — every capability lands with its checks wired
  in the same change.
- **SPEC.md tracks every capability from day one** — an entry in the
  same change (`LOCKED`/`OPEN`/`PARKED`, `UX: PROTOTYPE`/`FINAL` where a
  UI exists), mechanical changes exempted. Not in SPEC.md = undocumented.

## Build / dev commands

- **`task dev`** — THE way to run and iterate; start once, leave running.
  Frontend edits (`frontend/src/**`) are instant Vite HMR. Only a Go
  change restarts the app; only a *bound Go method signature* change
  re-pays `wails3 generate bindings` (~20s). Confirm the green `DEV ·
  live` badge. `wails3`/`ls_lint` live in `~/go/bin`.
- **`task install:app`** — build + install the real `.app`; use ONLY for
  Accessibility-gated hotkeys, the native menu, launch/Spotlight
  behaviour. Never while `task dev` is running.
- `task setup:hooks` — once after cloning: installs Lefthook's hooks
  (`brew install lefthook golangci-lint`, `go install
  github.com/loeffel-io/ls-lint/v2/cmd/ls_lint@v2.3.1` first).
- `task build` / `task package` — production binary / `.app` bundle to
  `bin/`. `wails3 dev` / `wails3 build` — the underlying CLI these wrap
  (`Taskfile.yml`, `build/Taskfile.yml`).

## Project layout

- `main.go` — the only root Go file: embeds, window/tray setup, service
  wiring. Wails-bound services live under `internal/services/<ctx>svc`,
  shared helpers in `internal/services/{seeding,servicetest}`.
- `frontend/` — React + TypeScript + Vite UI.
- `docs/SPEC.md` — living concept doc, rendered inside the app (Spec
  view); source of truth for positioning and architecture status.
- `.claude/rules/` — coding conventions, split by topic/language rather
  than piled into this file (see `docs/SPEC.md` §9 for the roadmap).
